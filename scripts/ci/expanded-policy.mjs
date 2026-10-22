import assert from 'node:assert/strict';

export const expandedBrowsers = Object.freeze(['firefox', 'webkit']);
const sha = /^[a-f0-9]{40}$/u;
const digest = /^[a-f0-9]{64}$/u;
const imageId = /^sha256:[a-f0-9]{64}$/u;
const version = /^\d+(?:\.\d+){1,3}(?:[-+][a-zA-Z0-9.-]+)?$/u;
const positive = (value) => typeof value === 'string' && /^[1-9]\d*$/u.test(value);
const exact = (value, keys) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};

export function validateExpandedCandidate({
  source,
  head,
  stage,
  main,
  workflowSha,
  nativeValidationDisabled,
}) {
  assert.ok(
    !nativeValidationDisabled,
    'La validación nativa de navegadores debe permanecer habilitada.',
  );
  assert.match(source, sha);
  assert.equal(head, source, 'Checkout distinto de la candidatura ampliada.');
  assert.ok(['rehearsal', 'final'].includes(stage));
  if (workflowSha !== undefined) assert.equal(workflowSha, source);
  if (stage === 'final') assert.equal(main, source, 'El cierre final debe corresponder a main.');
}

export function validateExpandedBrowser(report, browser) {
  assert.ok(expandedBrowsers.includes(browser));
  let count = 0;
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        assert.equal(test.projectName, browser, 'Motor de navegador distinto del solicitado.');
        count++;
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  assert.ok(count > 0);
}

export function validateExpandedManifest(report, { source, files, fixtures, images, execution }) {
  exact(report, [
    'version',
    'sourceMode',
    'source',
    'stage',
    'execution',
    'environment',
    'fixtures',
    'images',
    'cleanStart',
    'load',
    'browsers',
    'status',
  ]);
  assert.equal(report.version, 1);
  assert.equal(report.sourceMode, 'git-archive');
  assert.match(report.source, sha);
  assert.equal(report.source, source);
  assert.ok(['rehearsal', 'final'].includes(report.stage));
  assert.equal(report.status, 'passed');
  exact(report.execution, ['kind', 'runId', 'attempt']);
  assert.deepEqual(report.execution, execution);
  if (report.execution.kind === 'github') {
    assert.ok(positive(report.execution.runId) && positive(report.execution.attempt));
  } else {
    assert.equal(report.execution.kind, 'local');
    assert.equal(report.execution.runId, null);
    assert.equal(report.execution.attempt, null);
    assert.equal(report.stage, 'rehearsal');
  }
  exact(report.environment, ['os', 'arch', 'node', 'npm', 'docker', 'compose', 'playwright']);
  assert.equal(report.environment.os, 'linux');
  assert.equal(report.environment.arch, 'x64');
  assert.equal(report.environment.node, '24.22.0');
  assert.equal(report.environment.npm, '12.2.0');
  assert.equal(report.environment.playwright, '1.64.1');
  assert.match(report.environment.docker, version);
  assert.match(report.environment.compose, version);
  exact(report.fixtures, ['events', 'sample', 'detailed']);
  for (const hash of Object.values(report.fixtures)) assert.match(hash, digest);
  assert.deepEqual(report.fixtures, fixtures);
  assert.deepEqual(report.images, images);
  assert.equal(report.images.length, 3);
  assert.deepEqual(report.images.map((image) => image.name).sort(), ['api', 'db', 'web']);
  for (const image of report.images) {
    exact(image, ['name', 'id', 'revision', 'scan']);
    assert.match(image.id, imageId);
    assert.equal(image.revision, source);
    assert.equal(image.scan, 'passed');
  }
  exact(report.cleanStart, ['health', 'login', 'persistence', 'reset']);
  assert.ok(Object.values(report.cleanStart).every((value) => value === true));
  exact(report.load, [
    'events',
    'vehicles',
    'alerts',
    'batches',
    'positions',
    'repeatVerified',
    'peakRuntimeConnections',
    'peakWrites',
    'peakQueries',
    'peakQueueAndListener',
    'peakOutbox',
  ]);
  for (const [key, expected] of Object.entries({
    events: 100000,
    vehicles: 100,
    alerts: 40000,
    batches: 200,
    positions: 200000,
  }))
    assert.equal(report.load[key], expected);
  assert.equal(report.load.repeatVerified, true);
  for (const [key, limit] of Object.entries({
    peakRuntimeConnections: 16,
    peakWrites: 6,
    peakQueries: 4,
    peakQueueAndListener: 5,
    peakOutbox: 1,
  }))
    assert.ok(
      Number.isSafeInteger(report.load[key]) && report.load[key] >= 0 && report.load[key] <= limit,
    );
  assert.ok(report.load.peakRuntimeConnections > 0);
  assert.ok(Array.isArray(files) && files.length > 0 && new Set(files).size === files.length);
  assert.ok(
    files.every((file) => /^(?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*\.spec\.mjs$/u.test(file)),
  );
  assert.equal(report.browsers.length, expandedBrowsers.length);
  assert.deepEqual(report.browsers.map((browser) => browser.name).sort(), expandedBrowsers);
  for (const browser of report.browsers) {
    exact(browser, ['name', 'version', 'results']);
    assert.match(browser.version, version);
    assert.equal(browser.results.length, files.length);
    assert.deepEqual(browser.results.map((result) => result.file).sort(), [...files].sort());
    for (const result of browser.results) {
      exact(result, ['file', 'tests']);
      exact(result.tests, ['total', 'passed', 'failed', 'skipped']);
      assert.ok(Number.isSafeInteger(result.tests.total) && result.tests.total > 0);
      assert.equal(result.tests.passed, result.tests.total);
      assert.equal(result.tests.failed, 0);
      assert.equal(result.tests.skipped, 0);
    }
  }
  return report;
}
