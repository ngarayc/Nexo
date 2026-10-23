import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requiredJobs } from './policy.mjs';
import { validateReport, validateVitestReport, validateImageScan } from './results.mjs';
import { verifyTraceability } from './traceability.mjs';
import { prepareChromium, browserSetupSteps } from './browser-setup.mjs';

const job = process.argv[2];
if (!requiredJobs.includes(job)) throw new Error('Job de CI desconocido.');
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== process.env.GITHUB_SHA
) {
  throw new Error('Checkout distinto del candidato de CI.');
}
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('El checkout de CI contiene cambios de fuentes sin registrar.');
const checks = [];
const command = (program, args, timeout = 600000) =>
  execFileSync(program, args, { stdio: 'inherit', timeout });
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const passed = (name, tests) =>
  checks.push({ name, status: 'passed', ...(tests ? { tests } : {}) });
const tools = (name) => resolve('.cache/tools', `${name}-${versions[name].version}`, name);
const versions = await json('scripts/ci/tools.json');
await mkdir('reports/raw', { recursive: true });

if (job === 'quality') {
  command('npm', ['run', 'quality']);
  command(process.execPath, ['scripts/ci/check-workflows.mjs']);
  passed('workspace-quality');
  console.log('Trazabilidad:', verifyTraceability());
  passed('traceability');
  command('npm', ['run', 'test:ci-controls']);
  passed('ci-controls');
} else if (job === 'unit') {
  for (const [name, workspace, directory] of [
    ['api', '@nexo/api', 'apps/api/src'],
    ['web', '@nexo/web', 'apps/web/src'],
  ]) {
    const output = resolve(`reports/raw/${name}.json`);
    const options =
      name === 'api'
        ? ['--reporter=json', `--outputFile=${output}`]
        : ['--reporters=json', `--output-file=${output}`];
    command('npm', ['run', 'test:unit', '--workspace', workspace, '--', ...options]);
    const inventory = (await readdir(directory, { recursive: true }))
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => `${directory}/${file}`);
    passed(name, validateVitestReport(await json(output), inventory));
  }
} else if (job === 'integration') {
  command('bash', ['scripts/configure-local.sh']);
  command('docker', [
    'compose',
    '--env-file',
    '.env.local',
    '-f',
    'infra/compose.yaml',
    'build',
    'api',
    'db',
    'web',
  ]);
  command('npm', ['run', 'test:integration'], 1200000);
  passed('postgresql', await json('reports/integration-summary.json'));
} else if (job === 'security-source') {
  command(process.execPath, ['scripts/ci/install-tools.mjs']);
  command(tools('gitleaks'), ['git', '--redact', '--no-banner', '.']);
  passed('secrets');
  command('npm', ['audit', '--audit-level=high']);
  passed('dependencies');
  command(tools('trivy'), [
    'config',
    '--severity',
    'HIGH,CRITICAL',
    '--exit-code',
    '1',
    '--format',
    'json',
    '--output',
    'reports/raw/configuration.json',
    'infra',
  ]);
  const configuration = await json('reports/raw/configuration.json');
  if (
    configuration.Results?.length !== 4 ||
    configuration.Results.some(
      (result) => !result.MisconfSummary?.Successes || result.MisconfSummary.Failures,
    )
  ) {
    throw new Error('Escaneo de Dockerfiles incompleto o fallido.');
  }
  command(process.execPath, ['scripts/ci/check-compose.mjs']);
  passed('configuration');
} else if (job === 'system') {
  command('bash', ['scripts/configure-local.sh']);
  command('docker', ['compose', '--env-file', '.env.local', '-f', 'infra/compose.yaml', 'build']);
  command(process.execPath, ['scripts/ci/install-tools.mjs']);
  for (const name of ['api', 'web', 'db']) {
    const scan = spawnSync(
      tools('trivy'),
      [
        'image',
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
        `reports/raw/image-${name}.json`,
        `nexo-${name}:local`,
      ],
      {
        encoding: 'utf8',
        timeout: 600000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    await writeFile(
      `reports/raw/image-${name}-scanner.log`,
      `${scan.stdout ?? ''}\n${scan.stderr ?? ''}`,
    );
    const report = await json(`reports/raw/image-${name}.json`);
    validateImageScan(report, scan, name === 'api' ? ['alpine', 'node-pkg'] : ['alpine']);
    console.log(`Imagen ${name}: escaneo completo sin HIGH/CRITICAL.`);
  }
  passed('images');
  const browserSetupAttempts = new Map();
  await prepareChromium(async (name) => {
    const step = browserSetupSteps[name];
    const attempt = (browserSetupAttempts.get(name) ?? 0) + 1;
    browserSetupAttempts.set(name, attempt);
    console.log(`Preparación de Chromium: ${name}.`);
    const setup = spawnSync(step.program, step.args, {
      encoding: 'utf8',
      timeout: step.timeout,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await writeFile(
      `reports/raw/browser-${name}-${attempt}.log`,
      `${setup.stdout ?? ''}\n${setup.stderr ?? ''}`,
    );
    return setup;
  });
  console.log('Chromium: lanzamiento y DOM verificados.');
  command('npm', ['run', 'test:e2e']);
  passed('browser', await json('reports/system-summary.json'));
  // La persistencia se verifica de nuevo sobre las mismas imágenes del recorrido.
  command('npm', ['run', 'test:integration'], 1200000);
  passed('persistence');
}

if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error(
    'Las comprobaciones alteraron fuentes versionadas o crearon archivos fuera de la lista local permitida.',
  );
const report = {
  version: 1,
  job,
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  checks,
};
validateReport(report, {
  job,
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
});
await mkdir('reports/ci', { recursive: true });
await writeFile(`reports/ci/${job}.json`, JSON.stringify(report) + '\n');
console.log(`${job}: comprobaciones y reporte satisfactorios.`);
