import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-recovery-http.mjs', 'utf8');
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web'), {
  timeout: 180000,
});
after(() => stack.close(), { timeout: 180000 });
const run = (scenario, prefix = '') =>
  stack.apiScript(
    `${prefix}\nprocess.env.NEXO_RECOVERY_HTTP_CASE=${JSON.stringify(scenario)};\n${source}`,
  );
test('fallo SQL transitorio se recupera por HTTP sin reenvío ni efectos duplicados', () =>
  assert.equal(run('transient'), 'recovery-http-case-ok'));
test('HTTP y proxy distinguen agotamiento técnico; otro lote continúa y el estado no se reactiva al reiniciar', async () => {
  const id = randomUUID();
  const prefix = `globalThis.nexoFailureId=${JSON.stringify(id)};`;
  assert.equal(run('exhaustion', prefix), 'recovery-http-case-ok');
  const before = stack.sql(
    `SELECT row_to_json(b)::text FROM ingestion_batches b WHERE ingestion_id='${id}'`,
  );
  const items = stack.sql(
    `SELECT json_agg(i ORDER BY item_index)::text FROM ingestion_items i WHERE ingestion_id='${id}'`,
  );
  stack.compose('restart', 'api');
  await stack.waitHealthy();
  assert.equal(
    stack.sql(`SELECT row_to_json(b)::text FROM ingestion_batches b WHERE ingestion_id='${id}'`) ===
      before,
    true,
  );
  assert.equal(
    stack.sql(
      `SELECT json_agg(i ORDER BY item_index)::text FROM ingestion_items i WHERE ingestion_id='${id}'`,
    ) === items,
    true,
  );
  assert.equal(run('terminal_read', prefix), 'recovery-http-case-ok');
});
test('caída antes del commit conserva admisión y recupera el job expirado sin repetir POST', async () => {
  const id = randomUUID();
  const prefix = `globalThis.nexoCrashId=${JSON.stringify(id)};`;
  assert.equal(run('prepare_crash', prefix), 'recovery-http-case-ok');
  stack.compose('kill', '-s', 'SIGKILL', 'api');
  assert.equal(
    stack.sql(`SELECT generation FROM ingestion_items WHERE ingestion_id='${id}' AND item_index=0`),
    '1',
  );
  stack.sql(
    'DROP TRIGGER IF EXISTS recovery_fault ON telemetry_events;DROP FUNCTION IF EXISTS public.recovery_fault();DROP SEQUENCE IF EXISTS public.recovery_fault_counter;',
  );
  stack.compose('up', '-d', '--no-build', '--wait', 'api');
  assert.equal(run('verify_crash', prefix), 'recovery-http-case-ok');
});
test('SIGTERM con trabajo activo cierra antes de 15 segundos y recupera al reiniciar sin otro POST', () => {
  const id = randomUUID();
  const prefix = `globalThis.nexoCrashId=${JSON.stringify(id)};`;
  assert.equal(run('prepare_crash', prefix), 'recovery-http-case-ok');
  const container = stack.compose('ps', '-q', 'api');
  const started = performance.now();
  stack.compose('stop', 'api');
  assert.ok(performance.now() - started < 15000, 'El cierre respeta el presupuesto de Compose.');
  const exitCode = Number(
    execFileSync('docker', ['inspect', '--format', '{{.State.ExitCode}}', container], {
      encoding: 'utf8',
    }).trim(),
  );
  assert.equal(exitCode, 0, 'El cierre no depende de SIGKILL ni termina con un error de proceso.');
  stack.sql(
    'DROP TRIGGER IF EXISTS recovery_fault ON telemetry_events;DROP FUNCTION IF EXISTS public.recovery_fault();DROP SEQUENCE IF EXISTS public.recovery_fault_counter;',
  );
  stack.compose('up', '-d', '--no-build', '--wait', 'api');
  assert.equal(run('verify_crash', prefix), 'recovery-http-case-ok');
});
test('cuotas HTTP independientes admiten 1200 lecturas y 1200 POST; el siguiente recibe 429 sin crear trabajo', async () => {
  stack.compose('restart', 'api');
  await stack.waitHealthy();
  assert.equal(run('quotas'), 'recovery-http-case-ok');
});
