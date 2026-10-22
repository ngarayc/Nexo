import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateExpandedCandidate,
  validateExpandedBrowser,
  validateExpandedManifest,
} from './expanded-policy.mjs';
import { validatePlaywrightReport } from './results.mjs';

const source = 'a'.repeat(40),
  files = ['access.spec.mjs'];
const fixture = () => {
  const fixtures = { events: '1'.repeat(64), sample: '2'.repeat(64), detailed: '3'.repeat(64) };
  const images = ['api', 'web', 'db'].map((name) => ({
    name,
    id: 'sha256:' + '4'.repeat(64),
    revision: source,
    scan: 'passed',
  }));
  const execution = { kind: 'github', runId: '123', attempt: '1' };
  const report = {
    version: 1,
    sourceMode: 'git-archive',
    source,
    stage: 'final',
    execution: { ...execution },
    environment: {
      os: 'linux',
      arch: 'x64',
      node: '24.22.0',
      npm: '12.2.0',
      docker: '29.9.2',
      compose: '5.3.0',
      playwright: '1.64.1',
    },
    fixtures: { ...fixtures },
    images: globalThis.structuredClone(images),
    cleanStart: { health: true, login: true, persistence: true, reset: true },
    load: {
      events: 100000,
      vehicles: 100,
      alerts: 40000,
      batches: 200,
      positions: 200000,
      repeatVerified: true,
      peakRuntimeConnections: 16,
      peakWrites: 6,
      peakQueries: 4,
      peakQueueAndListener: 5,
      peakOutbox: 1,
    },
    browsers: ['firefox', 'webkit'].map((name) => ({
      name,
      version: '27.2',
      results: [{ file: files[0], tests: { total: 1, passed: 1, failed: 0, skipped: 0 } }],
    })),
    status: 'passed',
  };
  return { report, expected: { source, files, fixtures, images, execution } };
};
test('candidatura rechaza checkout distinto, referencia móvil, etapa desconocida y main ajeno', () => {
  const baseline = { source, head: source, stage: 'final', main: source, workflowSha: source };
  validateExpandedCandidate(baseline);
  for (const changes of [
    { source: 'main' },
    { head: 'b'.repeat(40) },
    { stage: 'unknown' },
    { main: 'c'.repeat(40) },
    { workflowSha: 'd'.repeat(40) },
    { nativeValidationDisabled: '1' },
  ])
    assert.throws(() => validateExpandedCandidate({ ...baseline, ...changes }));
});
test('manifiesto completo acepta resultado atribuible y rechaza otro candidato, intento o fixture', () => {
  const { report, expected } = fixture();
  validateExpandedManifest(report, expected);
  for (const mutate of [
    (r) => {
      r.sourceMode = 'working-tree';
    },
    (r) => {
      r.source = 'b'.repeat(40);
    },
    (r) => {
      r.execution.attempt = '2';
    },
    (r) => {
      r.fixtures.events = '9'.repeat(64);
    },
    (r) => {
      r.images[0].id = 'sha256:' + '8'.repeat(64);
    },
  ]) {
    const candidate = globalThis.structuredClone(report);
    mutate(candidate);
    assert.throws(() => validateExpandedManifest(candidate, expected));
  }
});
test('lista de publicación rechaza datos crudos en todos los niveles', () => {
  for (const mutate of [
    (r) => {
      r.log = 'SYNTHETIC_PRIVATE_NOTE';
    },
    (r) => {
      r.execution.cookie = 'SYNTHETIC_SESSION';
    },
    (r) => {
      r.environment.path = '/private/example';
    },
    (r) => {
      r.load.payload = {};
    },
    (r) => {
      r.cleanStart.trace = 'trace.zip';
    },
    (r) => {
      r.browsers[0].results[0].tests.error = 'SYNTHETIC_PRIVATE_NOTE';
    },
  ]) {
    const { report, expected } = fixture();
    mutate(report);
    assert.throws(() => validateExpandedManifest(report, expected));
  }
});
test('no acredita ensayo local como cierre ni carga menor, exceso de conexiones o reset pendiente', () => {
  for (const mutate of [
    (r) => {
      r.execution = { kind: 'local', runId: null, attempt: null };
    },
    (r) => {
      r.load.events = 10000;
    },
    (r) => {
      r.load.repeatVerified = false;
    },
    (r) => {
      r.load.peakRuntimeConnections = 17;
    },
    (r) => {
      r.cleanStart.reset = false;
    },
  ]) {
    const { report, expected } = fixture();
    mutate(report);
    if (report.execution.kind === 'local') expected.execution = { ...report.execution };
    assert.throws(() => validateExpandedManifest(report, expected));
  }
});
test('rechaza navegador, archivo, casos ausentes, fallidos u omitidos', () => {
  for (const mutate of [
    (r) => {
      r.browsers.pop();
    },
    (r) => {
      r.browsers[0].name = 'chromium';
    },
    (r) => {
      r.browsers[0].results = [];
    },
    (r) => {
      r.browsers[0].results[0].file = 'unknown.spec.mjs';
    },
    (r) => {
      r.browsers[0].results[0].tests = { total: 0, passed: 0, failed: 0, skipped: 0 };
    },
    (r) => {
      r.browsers[0].results[0].tests.skipped = 1;
    },
    (r) => {
      r.browsers[0].results[0].tests.failed = 1;
    },
  ]) {
    const { report, expected } = fixture();
    mutate(report);
    assert.throws(() => validateExpandedManifest(report, expected));
  }
});
test('valida motor real además de los resultados Playwright no vacíos y sin retries', () => {
  const report = {
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    errors: [],
    suites: [
      {
        specs: [
          {
            file: files[0],
            ok: true,
            tests: [
              { projectName: 'webkit', expectedStatus: 'passed', results: [{ status: 'passed' }] },
            ],
          },
        ],
      },
    ],
  };
  validatePlaywrightReport(report, files);
  validateExpandedBrowser(report, 'webkit');
  assert.throws(() => validateExpandedBrowser(report, 'firefox'));
  assert.throws(() => validateExpandedBrowser({ suites: [] }, 'webkit'));
});

test('permite inventario anidado y rechaza rutas privadas o fuera del directorio de pruebas', () => {
  const { report, expected } = fixture();
  expected.files = ['nested/access.spec.mjs'];
  for (const browser of report.browsers) browser.results[0].file = expected.files[0];
  validateExpandedManifest(report, expected);
  for (const file of ['../raw.spec.mjs', '/private/access.spec.mjs']) {
    expected.files = [file];
    for (const browser of report.browsers) browser.results[0].file = file;
    assert.throws(() => validateExpandedManifest(report, expected));
  }
});
