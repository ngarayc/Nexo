import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { platform, arch } from 'node:os';
import { run } from 'node:test';
import { inspect } from 'node:util';
import { firefox, webkit } from '@playwright/test';
import { testStack } from '../../tests/support/stack.mjs';
import { browserStack } from '../../tests/support/browser-stack.mjs';
import { queryProbeSource } from '../../tests/support/query-probe.mjs';
import { validateImageScan, validatePlaywrightReport } from './results.mjs';
import {
  expandedBrowsers,
  validateExpandedCandidate,
  validateExpandedBrowser,
  validateExpandedManifest,
} from './expanded-policy.mjs';

const source = process.argv[2],
  stage = process.argv[3];
rmSync('reports/expanded/manifest.json', { force: true });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 30000 }).trim();
const execution =
  process.env.GITHUB_ACTIONS === 'true'
    ? { kind: 'github', runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }
    : { kind: 'local', runId: null, attempt: null };
if (stage === 'final')
  assert.equal(execution.kind, 'github', 'El cierre final requiere ejecución remota.');
if (execution.kind === 'github') {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REPOSITORY, 'ngarayc/Nexo');
  assert.equal(process.env.GITHUB_SHA, source);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/development');
}
validateExpandedCandidate({
  source,
  stage,
  head: git('rev-parse', 'HEAD'),
  workflowSha: execution.kind === 'github' ? process.env.GITHUB_SHA : undefined,
  nativeValidationDisabled: process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS,
  development:
    stage === 'final'
      ? git('ls-remote', 'origin', 'refs/heads/development').split(/\s/u)[0]
      : undefined,
});
assert.equal(git('status', '--porcelain'), '', 'Fuentes modificadas antes del recorrido ampliado.');
const directory = resolve('reports/raw/expanded', randomUUID());
mkdirSync(directory, { recursive: true });
function command(name, program, args, { timeout = 600000, input } = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    input,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(
    directory + '/' + name + '.log',
    String(result.stdout ?? '') + '\n' + String(result.stderr ?? ''),
  );
  if (result.status !== 0 || result.error || result.signal)
    throw new Error('Comprobación ampliada no aprobada: ' + name);
  console.log('expanded: ' + name + ' aprobado.');
  return result.stdout;
}
const fixtures = Object.fromEntries(
  [
    ['events', 'fixtures/events.jsonl'],
    ['sample', 'fixtures/expected_sample.json'],
    ['detailed', 'fixtures/expected_detailed.json'],
  ].map(([name, path]) => [name, createHash('sha256').update(readFileSync(path)).digest('hex')]),
);
const environment = {
  os: platform(),
  arch: arch(),
  node: process.versions.node,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  docker: execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  }).trim(),
  compose: execFileSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' })
    .trim()
    .replace(/^v/u, ''),
  playwright: JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8'))
    .version,
};
// Git exporta únicamente archivos registrados del SHA: sin otro checkout,
// worktree, configuración privada o herramientas instaladas por el agente.
const archive = execFileSync('git', ['archive', '--format=tar', source], {
  maxBuffer: 64 * 1024 * 1024,
});
command('install-scanners', process.execPath, ['scripts/ci/install-tools.mjs']);
const trivyVersion = JSON.parse(readFileSync('scripts/ci/tools.json', 'utf8')).trivy.version;
const trivy = resolve('.cache/tools', 'trivy-' + trivyVersion, 'trivy');
const images = [];
for (const name of ['api', 'web', 'db']) {
  command(
    'build-' + name,
    'docker',
    [
      'build',
      '--label',
      'org.opencontainers.image.revision=' + source,
      '-t',
      'nexo-' + name + ':local',
      '-f',
      'infra/' + name + '.Dockerfile',
      '-',
    ],
    { input: archive },
  );
  const image = JSON.parse(
    execFileSync('docker', ['image', 'inspect', 'nexo-' + name + ':local'], { encoding: 'utf8' }),
  )[0];
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'], source);
  const path = directory + '/image-' + name + '.json';
  const scan = spawnSync(
    trivy,
    [
      'image',
      '--db-repository',
      'ghcr.io/aquasecurity/trivy-db',
      '--image-src',
      'docker',
      '--scanners',
      'vuln',
      '--severity',
      'HIGH,CRITICAL',
      '--exit-code',
      '1',
      '--format',
      'json',
      '--output',
      path,
      'nexo-' + name + ':local',
    ],
    { encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 },
  );
  writeFileSync(
    directory + '/image-' + name + '-scanner.log',
    String(scan.stdout ?? '') + '\n' + String(scan.stderr ?? ''),
  );
  const report = JSON.parse(readFileSync(path, 'utf8'));
  validateImageScan(report, scan, name === 'api' ? ['alpine', 'node-pkg'] : ['alpine']);
  assert.equal(report.Metadata.ImageID, image.Id);
  images.push({ name, id: image.Id, revision: source, scan: 'passed' });
  console.log('expanded: imagen ' + name + ' construida desde exportación y escaneada.');
}
const cleanFile = resolve('tests/expanded/clean-start.test.mjs');
let cleanSummary,
  observedClean = false;
for await (const event of run({ files: [cleanFile], concurrency: false, timeout: 330000 })) {
  if (event.type === 'test:stdout' || event.type === 'test:stderr')
    writeFileSync(directory + '/clean-output.log', event.data.message, { flag: 'a' });
  if (event.type === 'test:fail')
    writeFileSync(directory + '/clean-failure.log', inspect(event.data, { depth: 8 }) + '\n', {
      flag: 'a',
    });
  if (event.type === 'test:summary') {
    if (event.data.file === cleanFile)
      observedClean = event.data.success && event.data.counts.tests > 0;
    if (!event.data.file) cleanSummary = event.data;
  }
}
assert.ok(
  observedClean &&
    cleanSummary?.success &&
    cleanSummary.counts.tests === 1 &&
    cleanSummary.counts.passed === 1,
);
assert.ok(
  !cleanSummary.counts.failed &&
    !cleanSummary.counts.cancelled &&
    !cleanSummary.counts.skipped &&
    !cleanSummary.counts.todo,
);
console.log('expanded: arranque, login, persistencia y reset propios aprobados.');
const files = readdirSync('tests/system', { recursive: true })
  .filter((file) => file.endsWith('.spec.mjs'))
  .sort();
assert.ok(files.length > 0);
const browsers = [];
for (const name of expandedBrowsers) {
  const browser = await { firefox, webkit }[name].launch({ timeout: 15000 });
  let version;
  try {
    const page = await browser.newPage();
    await page.setContent('<p>nexo-browser-ready</p>', { timeout: 5000 });
    assert.equal(await page.locator('p').textContent(), 'nexo-browser-ready');
    version = browser.version();
  } finally {
    await browser.close();
  }
  const results = [];
  for (const file of files) {
    const stack = browserStack(file);
    const output = directory + '/' + name + '-' + file + '.json';
    try {
      mkdirSync(dirname(output), { recursive: true });
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      const result = spawnSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config=playwright.expanded.config.mjs',
          '--project=' + name,
          'tests/system/' + file,
        ],
        {
          env: { ...process.env, ...stack.browserEnvironment(), NEXO_SYSTEM_REPORT: output },
          encoding: 'utf8',
          timeout: 180000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      writeFileSync(
        output + '.process.log',
        String(result.stdout ?? '') + '\n' + String(result.stderr ?? ''),
      );
      assert.ok(
        result.status === 0 && !result.error && !result.signal,
        'Recorrido no aprobado: ' + name + '/' + file,
      );
      const report = JSON.parse(readFileSync(output, 'utf8'));
      const tests = validatePlaywrightReport(report, [file]);
      validateExpandedBrowser(report, name);
      results.push({ file, tests });
      console.log('expanded: ' + name + '/' + file + ', ' + tests.passed + ' casos aprobados.');
    } finally {
      stack.close();
    }
  }
  browsers.push({ name, version, results });
  writeFileSync(
    directory + '/browsers-validated.json',
    JSON.stringify({ source, images, browsers }) + '\n',
  );
}
let load;
const stack = testStack({ publishWeb: false });
try {
  stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
  const sourceCode = queryProbeSource();
  const result = JSON.parse(
    command(
      'volume',
      'docker',
      [
        'compose',
        '--project-name',
        stack.browserEnvironment().NEXO_SYSTEM_PROJECT,
        '--env-file',
        stack.browserEnvironment().NEXO_SYSTEM_ENV_FILE,
        '-f',
        'infra/compose.yaml',
        'exec',
        '-T',
        'api',
        'node',
        '--input-type=module',
        '-e',
        "process.env.NEXO_QUERY_CASE='volume';process.env.NEXO_QUERY_VOLUME_EVENTS='100000';\n" +
          sourceCode,
      ],
      { timeout: 3600000 },
    ),
  );
  assert.equal(result.status, 'queries-volume-ok');
  const metrics = result.metrics;
  load = Object.fromEntries(
    [
      'events',
      'vehicles',
      'alerts',
      'batches',
      'positions',
      'peakRuntimeConnections',
      'peakWrites',
      'peakQueries',
      'peakQueueAndListener',
      'peakOutbox',
      'measurements',
    ].map((key) => [key, metrics[key]]),
  );
  load.repeatVerified = true;
  writeFileSync(directory + '/volume-metrics.json', JSON.stringify(load) + '\n');
} finally {
  stack.close();
}
console.log('expanded: carga acumulada y repetición terminadas.');
for (const image of images) {
  assert.equal(
    execFileSync(
      'docker',
      ['image', 'inspect', 'nexo-' + image.name + ':local', '--format', '{{.Id}}'],
      { encoding: 'utf8' },
    ).trim(),
    image.id,
  );
}
assert.equal(git('rev-parse', 'HEAD'), source);
assert.equal(git('status', '--porcelain'), '');
if (stage === 'final')
  assert.equal(
    git('ls-remote', 'origin', 'refs/heads/development').split(/\s/u)[0],
    source,
    'Development cambió durante la validación ampliada.',
  );
const report = {
  version: 1,
  sourceMode: 'git-archive',
  source,
  stage,
  execution,
  environment,
  fixtures,
  images,
  cleanStart: { health: true, login: true, persistence: true, reset: true },
  load,
  browsers,
  status: 'passed',
};
validateExpandedManifest(report, { source, files, fixtures, images, execution });
mkdirSync('reports/expanded', { recursive: true });
writeFileSync('reports/expanded/manifest.json', JSON.stringify(report) + '\n');
console.log('expanded: manifiesto cerrado y satisfactorio; ningún log crudo publicable.');
