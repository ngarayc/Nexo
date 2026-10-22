import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

test(
  '10000 eventos por HTTP conservan consultas y presupuesto de conexiones; repetir no añade efectos',
  { timeout: 330000 },
  () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      const source = readFileSync('tests/support/check-queries.mjs', 'utf8');
      const result = JSON.parse(
        stack.apiScript(`process.env.NEXO_QUERY_CASE='volume';\n${source}`, {
          timeoutMilliseconds: 300000,
        }),
      );
      assert.equal(result.status, 'queries-volume-ok');
      assert.equal(result.metrics.events, 10000);
      assert.equal(result.metrics.vehicles, 100);
      assert.equal(result.metrics.alerts, 4000);
      assert.ok(result.metrics.peakRuntimeConnections <= 16);
      mkdirSync('reports', { recursive: true });
      writeFileSync('reports/volume-sample.json', JSON.stringify(result.metrics) + '\n');
    } finally {
      stack.close();
    }
  },
);
