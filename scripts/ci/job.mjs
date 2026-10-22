import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requiredJobs } from './policy.mjs';
import { validateReport, validateVitestReport } from './results.mjs';
import { verifyTraceability } from './traceability.mjs';

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
    configuration.Results?.length !== 3 ||
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
    command(tools('trivy'), [
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
    ]);
    const report = await json(`reports/raw/image-${name}.json`);
    if (!report.Metadata?.ImageID || !report.Results?.length)
      throw new Error('Escaneo de imagen incompleto.');
  }
  passed('images');
  command('npx', ['--no-install', 'playwright', 'install', '--with-deps', 'chromium']);
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
