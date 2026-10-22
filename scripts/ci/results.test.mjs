import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredJobs } from './policy.mjs';
import {
  validateGate,
  validateReport,
  validateVitestReport,
  validatePlaywrightReport,
  validateImageScan,
} from './results.mjs';

const scanReport = () => ({
  Metadata: { ImageID: 'sha256:' + 'a'.repeat(64) },
  Results: [
    { Type: 'alpine', Packages: [{ Name: 'musl' }] },
    { Type: 'node-pkg', Packages: [{ Name: '@nestjs/core' }] },
  ],
});
const scanExecution = () => ({ status: 0, signal: null, stderr: '', stdout: '' });
test('imagen exige proceso correcto e inventarios esperados reales', () => {
  assert.doesNotThrow(() =>
    validateImageScan(scanReport(), scanExecution(), ['alpine', 'node-pkg']),
  );
  for (const change of [{ status: 1 }, { signal: 'SIGTERM' }, { error: new Error('synthetic') }])
    assert.throws(() =>
      validateImageScan(scanReport(), { ...scanExecution(), ...change }, ['alpine']),
    );
  const report = scanReport();
  report.Results.pop();
  assert.throws(() => validateImageScan(report, scanExecution(), ['alpine', 'node-pkg']));
  report.Results[0].Packages = [];
  assert.throws(() => validateImageScan(report, scanExecution(), ['alpine']));
});
test('exit0 no convierte detalles de vulnerabilidad ausentes en un escaneo completo', () => {
  for (const message of [
    'WARN Unable to get vulnerability details (CVE may be rejected)',
    '{"level":"warn","message":"no vulnerability details"}',
  ])
    assert.throws(
      () => validateImageScan(scanReport(), { ...scanExecution(), stderr: message }, ['alpine']),
      /inconcluso/,
    );
  assert.doesNotThrow(() =>
    validateImageScan(
      scanReport(),
      {
        ...scanExecution(),
        stderr: 'WARN Using severities from other vendors for some vulnerabilities.',
      },
      ['alpine'],
    ),
  );
});
test('inventario válido no oculta severidad desconocida o alta aunque proceso diga0', () => {
  for (const Severity of ['HIGH', 'CRITICAL', 'UNKNOWN']) {
    const report = scanReport();
    report.Results[0].Vulnerabilities = [{ Severity }];
    assert.throws(() => validateImageScan(report, scanExecution(), ['alpine']));
  }
});

const playwrightReport = () => ({
  stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
  errors: [],
  suites: [
    {
      specs: [
        {
          file: 'page.spec.mjs',
          ok: true,
          tests: [{ expectedStatus: 'passed', results: [{ status: 'passed' }] }],
        },
      ],
    },
  ],
});

test('navegador exige archivos esperados y casos realmente aprobados', () => {
  assert.equal(validatePlaywrightReport(playwrightReport(), ['page.spec.mjs']).passed, 1);
  assert.throws(() =>
    validatePlaywrightReport(playwrightReport(), ['page.spec.mjs', 'missing.spec.mjs']),
  );
  assert.throws(() => validatePlaywrightReport(playwrightReport(), []));
});

test('navegador rechaza esperados fallidos, reintentos y omisiones', () => {
  for (const change of [
    { expectedStatus: 'failed' },
    { results: [{ status: 'passed' }, { status: 'passed' }] },
    { results: [{ status: 'skipped' }] },
  ]) {
    const report = playwrightReport();
    Object.assign(report.suites[0].specs[0].tests[0], change);
    assert.throws(() => validatePlaywrightReport(report, ['page.spec.mjs']));
  }
  for (const change of [{ expected: 0 }, { flaky: 1 }, { skipped: 1 }, { unexpected: 1 }]) {
    const report = playwrightReport();
    Object.assign(report.stats, change);
    assert.throws(() => validatePlaywrightReport(report, ['page.spec.mjs']));
  }
});

const metadata = { sha: 'a'.repeat(40), runId: '123', attempt: '1' };
const metrics = { total: 2, passed: 2, failed: 0, skipped: 0 };
const names = {
  quality: ['workspace-quality', 'traceability', 'ci-controls'],
  unit: ['api', 'web'],
  integration: ['postgresql'],
  'security-source': ['secrets', 'dependencies', 'configuration'],
  system: ['images', 'browser', 'persistence'],
};
const reportFor = (job) => ({
  version: 1,
  job,
  ...metadata,
  checks: names[job].map((name) => ({
    name,
    status: 'passed',
    ...(['api', 'web', 'postgresql', 'browser'].includes(name) ? { tests: { ...metrics } } : {}),
  })),
});
const gate = () => ({
  ...metadata,
  results: Object.fromEntries(requiredJobs.map((job) => [job, 'success'])),
  reports: Object.fromEntries(requiredJobs.map((job) => [job, reportFor(job)])),
});
const vitestReport = () => ({
  success: true,
  numTotalTests: 2,
  numPassedTests: 2,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    {
      name: '/checkout/apps/api/src/config.spec.ts',
      status: 'passed',
      assertionResults: [{ status: 'passed' }, { status: 'passed' }],
    },
  ],
});

test('acepta cinco jobs satisfactorios del mismo candidato y ejecución', () =>
  validateGate(gate()));

for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
  test(`bloquea un job obligatorio ${String(result)}`, () => {
    const input = gate();
    input.results.unit = result;
    assert.throws(() => validateGate(input));
  });
}

test('bloquea reportes ausentes aunque GitHub indique éxito', () => {
  const input = gate();
  delete input.reports.integration;
  assert.throws(() => validateGate(input));
});

test('un reporte de otro SHA, intento, job o versión no acredita el candidato', () => {
  for (const change of [
    { sha: 'b'.repeat(40) },
    { runId: '122' },
    { attempt: '2' },
    { job: 'quality' },
    { version: 0 },
  ]) {
    assert.throws(() =>
      validateReport({ ...reportFor('unit'), ...change }, { ...metadata, job: 'unit' }),
    );
  }
  assert.throws(() => validateReport(reportFor('unit'), { job: 'unit' }));
});

test('bloquea controles duplicados, faltantes o fallidos', () => {
  for (const checks of [
    [],
    [reportFor('unit').checks[0], reportFor('unit').checks[0]],
    [{ name: 'api', status: 'failed' }, reportFor('unit').checks[1]],
  ]) {
    assert.throws(() =>
      validateReport({ ...reportFor('unit'), checks }, { ...metadata, job: 'unit' }),
    );
  }
});

test('una suite vacía o con casos omitidos no se convierte en verde', () => {
  for (const tests of [
    { total: 0, passed: 0, failed: 0, skipped: 0 },
    { total: 2, passed: 1, failed: 0, skipped: 1 },
    { ...metrics, total: 1.5 },
  ]) {
    const report = reportFor('unit');
    report.checks[0].tests = tests;
    assert.throws(() => validateReport(report, { ...metadata, job: 'unit' }));
  }
});

test('rechaza campos fuera de la lista de publicación', () => {
  assert.throws(() =>
    validateReport(
      { ...reportFor('unit'), logs: 'contenido no publicable' },
      { ...metadata, job: 'unit' },
    ),
  );
  const report = reportFor('unit');
  report.checks[0].cookie = 'marcador';
  assert.throws(() => validateReport(report, { ...metadata, job: 'unit' }));
});

test('extrae métricas del reporte real conservando inventario de archivos', () => {
  assert.deepEqual(validateVitestReport(vitestReport(), ['apps/api/src/config.spec.ts']), metrics);
});

test('omitir un archivo o vaciar el inventario bloquea aunque los casos restantes pasen', () => {
  assert.throws(() => validateVitestReport(vitestReport(), []));
  assert.throws(() =>
    validateVitestReport(vitestReport(), [
      'apps/api/src/config.spec.ts',
      'apps/api/src/other.spec.ts',
    ]),
  );
});

test('bloquea discrepancia entre totales y casos, o una suite vacía', () => {
  const input = vitestReport();
  input.testResults[0].assertionResults.pop();
  assert.throws(() => validateVitestReport(input, ['apps/api/src/config.spec.ts']));
  input.testResults[0].assertionResults = [];
  assert.throws(() => validateVitestReport(input, ['apps/api/src/config.spec.ts']));
});

test('el fallo, skip o todo real bloquea antes de producir el resumen', () => {
  for (const status of ['failed', 'pending', 'todo', 'skipped']) {
    const input = vitestReport();
    input.testResults[0].assertionResults[0].status = status;
    assert.throws(() => validateVitestReport(input, ['apps/api/src/config.spec.ts']));
  }
  for (const change of [
    { success: false },
    { numPendingTests: 1 },
    { numTodoTests: 1 },
    { numFailedTests: 1 },
  ]) {
    assert.throws(() =>
      validateVitestReport({ ...vitestReport(), ...change }, ['apps/api/src/config.spec.ts']),
    );
  }
});
