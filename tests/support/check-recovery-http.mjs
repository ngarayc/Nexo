import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { encodeIdentity } from '/app/apps/api/dist/modules/telemetry/domain/identity.js';

const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const event = (overrides = {}) => ({
  eventId: randomUUID(),
  vehicleId: randomUUID(),
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph: 81,
  ignitionOn: true,
  ...overrides,
});
const key = (value) => Buffer.from(encodeIdentity(value));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(
  path,
  { events, raw, id = randomUUID(), proxy = false, invalidKey = false } = {},
) {
  const body =
    raw !== undefined
      ? Buffer.from(raw)
      : events
        ? Buffer.from(JSON.stringify({ events }))
        : undefined;
  return new Promise((resolve, reject) => {
    const call = http.request(
      {
        hostname: proxy ? 'web' : '127.0.0.1',
        port: proxy ? 8080 : 3000,
        path,
        method: body ? 'POST' : 'GET',
        signal: globalThis.AbortSignal.timeout(90000),
        headers: {
          Host: 'localhost',
          Connection: 'close',
          'X-API-Key': invalidKey ? 'invalid-test-key' : process.env.INGEST_API_KEY,
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                'Idempotency-Key': id,
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024)
            response.destroy(new Error('Respuesta fuera del presupuesto de prueba.'));
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          try {
            resolve({
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch {
            reject(new Error('Respuesta JSON no comprobable.'));
          }
        });
      },
    );
    call.once('error', reject);
    call.end(body);
  });
}
async function clearFault() {
  await owner.query(
    'DROP TRIGGER IF EXISTS recovery_fault ON telemetry_events;DROP FUNCTION IF EXISTS public.recovery_fault();DROP SEQUENCE IF EXISTS public.recovery_fault_counter;',
  );
}
async function fault(eventId, kind) {
  await clearFault();
  await owner.query(
    'CREATE SEQUENCE public.recovery_fault_counter;GRANT USAGE ON SEQUENCE public.recovery_fault_counter TO nexo_app;',
  );
  const hex = key(eventId).toString('hex');
  const action =
    kind === 'once'
      ? "IF nextval('public.recovery_fault_counter')=1 THEN RAISE EXCEPTION 'TRANSIENT_FAULT' USING ERRCODE='40P01';END IF;"
      : kind === 'always'
        ? "RAISE EXCEPTION 'TRANSIENT_FAULT' USING ERRCODE='40P01';"
        : 'PERFORM pg_sleep(20);';
  // DDL exclusivo del PostgreSQL sintético: no hay flags/hooks de fallo en la API.
  await owner.query(
    `CREATE FUNCTION public.recovery_fault() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fault$ BEGIN IF NEW.event_key=decode('${hex}','hex') THEN ${action} END IF;RETURN NEW;END;$fault$;CREATE TRIGGER recovery_fault BEFORE INSERT ON telemetry_events FOR EACH ROW EXECUTE FUNCTION public.recovery_fault();`,
  );
}
async function item(id, index = 0) {
  return (
    await owner.query(
      'SELECT state,generation,opportunities_reserved,failure_code,last_failure_generation,last_failure_at FROM ingestion_items WHERE ingestion_id=$1 AND item_index=$2',
      [id, index],
    )
  ).rows[0];
}
const cases = {
  async quotas() {
    const count = async () =>
      (
        await owner.query(`SELECT
      (SELECT count(*) FROM ingestion_batches)::text AS batches,
      (SELECT count(*) FROM telemetry_events)::text AS events,
      (SELECT count(*) FROM outbox_messages)::text AS messages`)
      ).rows[0];
    const before = await count();
    const path = `/api/ingestions/${randomUUID()}`;
    const started = Date.now();
    for (const [url, options, status] of [
      [path, {}, 404],
      ['/api/events/batch', { raw: '{' }, 400],
    ]) {
      for (let group = 0; group < 120; group++) {
        const responses = await Promise.all(
          Array.from({ length: 10 }, () => request(url, options)),
        );
        for (const response of responses) {
          assert.equal(response.status, status);
          if (status === 400) assert.equal(response.body.code, 'MALFORMED_JSON');
        }
      }
      const limited = await request(url, options);
      assert.equal(limited.status, 429);
      assert.equal(limited.body.code, 'RATE_LIMITED');
      const denied = await request(url, { ...options, invalidKey: true });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, 'INVALID_API_KEY');
    }
    assert.equal(Date.now() - started < 60000, true, 'Ambas cuotas se observaron en una ventana.');
    assert.deepEqual(
      await count(),
      before,
      'Ninguna petición de cuota crea recepciones o efectos.',
    );
  },
  async transient() {
    const source = event(),
      id = randomUUID();
    await fault(source.eventId, 'once');
    const result = await request('/api/events/batch', { events: [source], id });
    assert.equal(result.status, 200);
    assert.deepEqual(
      [result.body.accepted, result.body.duplicates, result.body.rejected],
      [1, 0, 0],
    );
    assert.equal(result.body.complete, true);
    assert.equal(result.body.revision, 2);
    const stored = await item(id);
    assert.equal(stored.state, 'classified');
    assert.equal(stored.generation, 2);
    assert.equal(stored.opportunities_reserved, 2);
    assert.equal(stored.last_failure_generation, 1);
    assert.equal(stored.last_failure_at !== null, true);
    assert.equal(stored.failure_code, 'PROCESSING_UNCONFIRMED');
    const counts = (
      await owner.query(
        `SELECT (SELECT count(*)::int FROM telemetry_events WHERE event_key=$1) AS events,
    (SELECT count(*)::int FROM outbox_messages WHERE event_pk=(SELECT event_pk FROM telemetry_events WHERE event_key=$1)) AS messages`,
        [key(source.eventId)],
      )
    ).rows[0];
    assert.deepEqual(counts, { events: 1, messages: 3 });
    const read = await request(`/api/ingestions/${id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.accepted, 1);
  },
  async exhaustion() {
    const id = globalThis.nexoFailureId;
    const events = [event({ speedKph: 80 }), event(), event()];
    await fault(events[1].eventId, 'always');
    const healthyId = randomUUID();
    const [failed, healthy] = await Promise.all([
      request('/api/events/batch', { id, events, proxy: true }),
      request('/api/events/batch', { id: healthyId, events: [event()], proxy: true }),
    ]);
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body.accepted, 1);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.code, 'INGESTION_PROCESSING_FAILED');
    assert.equal(failed.body.admission, 'admitted');
    assert.equal(failed.body.resultsAvailable, true);
    assert.deepEqual(
      [failed.body.accepted, failed.body.duplicates, failed.body.rejected],
      [1, 0, 0],
    );
    assert.equal(failed.body.complete, false);
    assert.deepEqual(failed.body.pendingIndexes, []);
    assert.deepEqual(failed.body.failedIndexes, [1, 2]);
    assert.deepEqual(failed.body.failures, [
      { index: 1, code: 'PROCESSING_UNCONFIRMED' },
      { index: 2, code: 'BLOCKED_BY_PREVIOUS_FAILURE' },
    ]);
    const cause = await item(id, 1),
      suffix = await item(id, 2);
    assert.equal(cause.generation, 3);
    assert.equal(cause.opportunities_reserved, 3);
    assert.equal(cause.last_failure_generation, 3);
    assert.equal(suffix.generation, 0);
    assert.equal(suffix.opportunities_reserved, 0);
    assert.equal(suffix.last_failure_at, null);
    for (const source of events.slice(1))
      assert.equal(
        (
          await owner.query('SELECT count(*) FROM telemetry_events WHERE event_key=$1', [
            key(source.eventId),
          ])
        ).rows[0].count,
        '0',
      );
    const read = await request(`/api/ingestions/${id}`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.failedIndexes, [1, 2]);
  },
  async terminal_read() {
    const id = globalThis.nexoFailureId;
    const read = await request(`/api/ingestions/${id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.complete, false);
    assert.deepEqual(read.body.failedIndexes, [1, 2]);
    assert.deepEqual(read.body.pendingIndexes, []);
    assert.equal((await item(id, 1)).opportunities_reserved, 3);
  },
  async prepare_crash() {
    const id = globalThis.nexoCrashId;
    const source = event({ eventId: 'crash-' + id, vehicleId: 'crash-' + id });
    await fault(source.eventId, 'sleep');
    // Cliente separado del proceso servidor. Sale sin respuesta ni reenvío;
    // el trabajo admitido continúa hasta la caída forzada del servidor.
    void request('/api/events/batch', { id, events: [source] }).catch(() => {});
    let active = false;
    for (let n = 0; n < 100 && !active; n++) {
      active = (
        await owner.query(
          "SELECT EXISTS(SELECT 1 FROM pgboss.job WHERE name='telemetry.ingest' AND data->>'ingestionId'=$1 AND state='active') AS active",
          [id],
        )
      ).rows[0].active;
      if (!active) await pause(20);
    }
    assert.equal(active, true);
    await pause(100);
  },
  async verify_crash() {
    const id = globalThis.nexoCrashId;
    const deadline = Date.now() + 70000;
    let read;
    do {
      read = await request(`/api/ingestions/${id}`);
      assert.equal(read.status, 200);
      if (read.body.complete) break;
      assert.deepEqual(read.body.failedIndexes, []);
      await pause(100);
    } while (Date.now() < deadline);
    assert.equal(
      read.body.complete,
      true,
      'El supervisor y reconciliador recuperan sin otro POST.',
    );
    assert.equal(read.body.accepted, 1);
    assert.equal(read.body.rejected, 0);
    const stored = await item(id);
    assert.equal(stored.generation, 2);
    assert.equal(stored.opportunities_reserved, 2);
    assert.equal(stored.last_failure_generation, 1);
    assert.equal(
      (await owner.query('SELECT count(*) FROM ingestion_batches WHERE ingestion_id=$1', [id]))
        .rows[0].count,
      '1',
    );
    assert.equal(
      (
        await owner.query('SELECT count(*) FROM telemetry_events WHERE event_key=$1', [
          key('crash-' + id),
        ])
      ).rows[0].count,
      '1',
    );
  },
};
const scenario = process.env.NEXO_RECOVERY_HTTP_CASE;
if (scenario === 'prepare_crash') {
  await cases.prepare_crash();
  console.log('recovery-http-case-ok');
  process.exit(0);
}
try {
  assert.equal(Object.hasOwn(cases, scenario), true);
  await cases[scenario]();
  console.log('recovery-http-case-ok');
} finally {
  try {
    await clearFault();
  } finally {
    await owner.end();
  }
}
