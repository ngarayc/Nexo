import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  latencySummary,
  createVolumeObservations,
} from '../../tests/support/volume-observations.mjs';
import { queryProbeSource } from '../../tests/support/query-probe.mjs';
import { validateLoadMeasurements } from './load-measurements-policy.mjs';

import { measurementFixture } from './load-measurements-fixture.mjs';

test('percentiles nearest-rank independientes, sin modificar muestras y con unidades verificables', () => {
  const samples = [20, 3, 1, 9, 2];
  assert.deepEqual(latencySummary(samples), {
    samples: 5,
    minimum: 1,
    p50: 3,
    p95: 20,
    p99: 20,
    maximum: 20,
  });
  assert.deepEqual(samples, [20, 3, 1, 9, 2]);
  const hundred = latencySummary(Array.from({ length: 100 }, (_, n) => n + 1));
  assert.deepEqual([hundred.p50, hundred.p95, hundred.p99], [50, 95, 99]);
  for (const invalid of [[], [NaN], [-1], [Infinity]]) assert.throws(() => latencySummary(invalid));
});

test('observa servidor PID1, cgroup y ambas latencias; distingue pendiente de fallo', async () => {
  let clock = 0,
    rss = 2,
    container = 8192;
  const reads = [];
  const observer = createVolumeObservations({
    now: () => clock,
    readText: async (path) => {
      reads.push(path);
      if (path.endsWith('cmdline')) return 'node\0/app/apps/api/dist/main.js\0';
      if (path.endsWith('/cgroup')) return '0::/\n';
      if (path.endsWith('status')) return `Name: node\nVmRSS: ${rss} kB\n`;
      if (path.endsWith('memory.current')) return String(container);
      throw new Error('Fixture no esperado.');
    },
  });
  await observer.sampleMemory();
  await observer.sampleMemory();
  assert.equal(reads.filter((path) => path.endsWith('status')).length, 1);
  const first = observer.start();
  clock = 10;
  observer.post(200, first);
  clock = 15;
  observer.confirmed(first);
  const second = observer.start();
  clock = 25;
  observer.post(503, second);
  observer.poll();
  clock = 35;
  observer.confirmed(second);
  clock = 1000;
  rss = 4;
  container = 16384;
  await observer.sampleMemory();
  const value = observer.summary(2);
  validateLoadMeasurements(value, 2);
  assert.deepEqual(
    [
      value.post.p50,
      value.post.maximum,
      value.receiptCompletion.p50,
      value.receiptCompletion.maximum,
    ],
    [10, 10, 15, 20],
  );
  assert.deepEqual(
    [
      value.memory.samples,
      value.memory.apiProcessPeakRssBytes,
      value.memory.containerPeakUsageBytes,
    ],
    [2, 4096, 16384],
  );
  assert.deepEqual(value.responses, {
    http200: 1,
    pending503: 1,
    receiptPolls: 1,
    unexpected: 0,
    requestFailures: 0,
  });
  observer.failedRequest();
  assert.throws(() => observer.summary(2));
});

test('memoria ilegible o de otro proceso y observación incompleta nunca generan un resultado válido', async () => {
  const wrong = createVolumeObservations({ readText: async () => 'sh\0other\0' });
  await assert.rejects(wrong.sampleMemory(), /No se pudo medir/);
  const absent = createVolumeObservations({
    readText: async () => {
      throw new Error('synthetic-private');
    },
  });
  await assert.rejects(absent.sampleMemory(), /No se pudo medir/);
  assert.throws(() => wrong.summary(1));
});

test('el lector v1 conserva unidades y rechaza cgroup ajeno o contadores no verificables', async () => {
  for (const mode of ['valid', 'foreign', 'invalid']) {
    const observer = createVolumeObservations({
      readText: async (path) => {
        if (path.endsWith('cmdline')) return 'node\0/app/apps/api/dist/main.js\0';
        if (path.endsWith('/cgroup'))
          return mode === 'foreign' ? '0::/host-scope\n' : '3:memory:/\n';
        if (path.endsWith('status')) return 'VmRSS: 42 kB\n';
        if (path.endsWith('memory.current')) throw new Error('Synthetic v1 fixture.');
        if (path.endsWith('memory.usage_in_bytes'))
          return mode === 'invalid' ? 'invalid' : '1048576';
        throw new Error('Fixture no esperado.');
      },
    });
    if (mode !== 'valid') {
      await assert.rejects(observer.sampleMemory(), /No se pudo medir/);
      continue;
    }
    await observer.sampleMemory(true);
    await observer.sampleMemory(true);
    const start = observer.start();
    observer.post(200, start);
    observer.confirmed(start);
    const result = observer.summary(1);
    validateLoadMeasurements(result, 1);
    assert.deepEqual(
      [
        result.memory.cgroupVersion,
        result.memory.apiProcessPeakRssBytes,
        result.memory.containerPeakUsageBytes,
      ],
      [1, 43008, 1048576],
    );
  }
});

test('el esquema rechaza muestras menores, errores, memoria falsa, campos privados y métricas incoherentes', () => {
  validateLoadMeasurements(measurementFixture(), 200);
  for (const mutate of [
    (m) => {
      m.post.samples = 20;
    },
    (m) => {
      m.responses.unexpected = 1;
    },
    (m) => {
      m.responses.requestFailures = 1;
    },
    (m) => {
      m.responses.receiptPolls = 0;
    },
    (m) => {
      m.post.p95 = -1;
    },
    (m) => {
      m.receiptCompletion.maximum = 0;
    },
    (m) => {
      m.memory.samples = 0;
    },
    (m) => {
      m.memory.apiProcessPeakRssBytes = 0;
    },
    (m) => {
      m.memory.containerIncludesLoadClient = false;
    },
    (m) => {
      m.memory.cookie = 'SYNTHETIC_PRIVATE';
    },
    (m) => {
      m.post.raw = 'SYNTHETIC_PRIVATE';
    },
  ]) {
    const value = measurementFixture();
    mutate(value);
    assert.throws(() => validateLoadMeasurements(value, 200));
  }
});

test('el cliente entregado al contenedor conserva el módulo probado y es ESM válido', () => {
  const source = queryProbeSource();
  assert.ok(source.includes('data:text/javascript;base64,'));
  assert.equal(source.includes("from './volume-observations.mjs'"), false);
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0);
});
