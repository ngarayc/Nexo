import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { setInterval, clearInterval } from 'node:timers';
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { PostgresReadModel } from '/app/apps/api/dist/modules/queries/adapters/postgres/read-model.js';
import { encodeIdentity } from '/app/apps/api/dist/modules/telemetry/domain/identity.js';

const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const runtime = new Pool(readDatabaseConfig(process.env).pool);
let cookie, token;
const origin = process.env.PUBLIC_ORIGIN;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
async function request(
  path,
  {
    body,
    raw,
    method = body !== undefined || raw !== undefined ? 'POST' : 'GET',
    proxy = true,
    authenticated = true,
    csrf = token,
    requestOrigin = origin,
    key = false,
    headers = {},
  } = {},
) {
  const bytes =
    raw !== undefined
      ? Buffer.from(raw)
      : body !== undefined
        ? Buffer.from(JSON.stringify(body))
        : undefined;
  return new Promise((resolve, reject) => {
    const call = http.request(
      {
        hostname: proxy ? 'web' : '127.0.0.1',
        port: proxy ? 8080 : 3000,
        path,
        method,
        signal: globalThis.AbortSignal.timeout(90000),
        headers: {
          Host: 'localhost',
          Connection: 'close',
          ...(authenticated && cookie ? { Cookie: cookie } : {}),
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(key ? { 'X-API-Key': process.env.INGEST_API_KEY } : {}),
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 16 * 1024 * 1024)
            response.destroy(new Error('Respuesta excede presupuesto de prueba.'));
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          try {
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch {
            reject(new Error('Respuesta JSON no comprobable.'));
          }
        });
      },
    );
    call.once('error', reject);
    call.end(bytes);
  });
}
async function login() {
  const result = await request('/api/session', {
    body: { username: 'demo', password: 'demo' },
    authenticated: false,
  });
  assert.equal(result.status, 200);
  cookie = result.headers['set-cookie'][0].split(';')[0];
  token = result.body.csrfToken;
}
async function ingest(events) {
  const result = await request('/api/events/batch', {
    body: { events },
    key: true,
    authenticated: false,
    csrf: undefined,
  });
  assert.equal(result.status, 200);
  return result.body;
}
async function get(path) {
  const r = await request(path);
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  return r.body;
}
async function history(vehicleId) {
  const r = await request('/api/queries/vehicle-events', { body: { vehicleId } });
  assert.equal(r.status, 200);
  return r.body;
}
async function settled() {
  for (let n = 0; n < 100; n++) {
    const active = (
      await owner.query(
        "SELECT count(*) FROM pgboss.job WHERE name='telemetry.ingest' AND state IN ('created','retry','active')",
      )
    ).rows[0].count;
    if (active === '0') return;
    await pause(20);
  }
  throw new Error('El consumidor no terminó sus ACK dentro del plazo.');
}
async function snapshotRows() {
  const rows = {};
  for (const [table, order] of Object.entries({
    telemetry_events: 'event_pk',
    vehicle_latest: 'vehicle_pk',
    alerts: 'event_pk',
    outbox_messages: 'message_id',
    ingestion_batches: 'ingestion_id',
    ingestion_items: 'ingestion_id,item_index',
  }))
    rows[table] = (
      await owner.query(
        `SELECT coalesce(json_agg(t ORDER BY ${order}),'[]'::json)::text AS data FROM ${table} t`,
      )
    ).rows[0].data;
  rows.jobs = (
    await owner.query(
      "SELECT coalesce(json_agg(t ORDER BY id),'[]'::json)::text AS data FROM pgboss.job t WHERE name='telemetry.ingest'",
    )
  ).rows[0].data;
  return rows;
}
const cases = {
  async volume() {
    const runId = randomUUID();
    const sources = Array.from({ length: 10000 }, (_, n) =>
      event({
        eventId: `volume-${runId}-${String(n).padStart(5, '0')}`,
        vehicleId: `VOLUME-${String(n % 100).padStart(3, '0')}`,
        observedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
        speedKph: [0, 40, 80, 81, 95][n % 5],
        ignitionOn: n % 7 !== 0,
      }),
    );
    const stats = { total: 0, writes: 0, queries: 0, queue: 0 };
    let sampling,
      samplingFailure,
      stopped = false;
    const sample = async () => {
      const rows = (
        await owner.query(`SELECT application_name,count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND usename='nexo_app' AND backend_type='client backend' GROUP BY application_name`)
      ).rows;
      const total = rows.reduce((n, r) => n + r.n, 0);
      stats.total = Math.max(stats.total, total);
      for (const [name, key, limit] of [
        ['nexo-writes', 'writes', 6],
        ['nexo-queries', 'queries', 4],
        // pg-boss usa el mismo application_name para su pool (4) y listener (1).
        ['nexo-queue', 'queue', 5],
      ]) {
        const n = rows.find((r) => r.application_name === name)?.n ?? 0;
        stats[key] = Math.max(stats[key], n);
        assert.ok(n <= limit);
      }
      assert.ok(total <= 15, 'Los pools y listener del runtime respetan su presupuesto.');
    };
    const timer = setInterval(() => {
      if (sampling || stopped) return;
      sampling = sample().finally(() => {
        sampling = undefined;
      });
      void sampling.catch((error) => {
        samplingFailure = error;
      });
    }, 100);
    const started = Date.now();
    const receipts = [];
    const submit = async (events) => {
      const id = randomUUID();
      let result = await request('/api/events/batch', {
        body: { events },
        key: true,
        authenticated: false,
        headers: { 'Idempotency-Key': id },
      });
      if (result.status === 503) {
        assert.equal(result.body.code, 'INGESTION_RESULT_PENDING');
        assert.equal(result.body.admission, 'admitted');
        const deadline = Date.now() + 90000;
        do {
          await pause(250);
          result = await request(`/api/ingestions/${id}`, { key: true, authenticated: false });
          assert.equal(result.status, 200);
          if (result.body.complete) break;
          assert.deepEqual(result.body.failedIndexes, []);
        } while (Date.now() < deadline);
      }
      assert.equal(result.status, 200);
      assert.equal(result.body.complete, true);
      assert.equal(result.body.ingestionId, id);
      receipts.push(id);
      return result.body;
    };
    const coherent = async () => {
      const snapshot = await get('/api/snapshot');
      assert.equal(snapshot.vehicles.total, snapshot.vehicles.items.length);
      assert.equal(snapshot.alerts.total, snapshot.alerts.items.length);
      const vehicles = new Set(snapshot.vehicles.items.map((v) => v.vehicleId));
      for (const alert of snapshot.alerts.items)
        assert.ok(
          vehicles.has(alert.vehicleId),
          'Una alerta visible tiene vehículo en la misma vista.',
        );
    };
    const effects = async () =>
      (
        await owner.query(`SELECT
      (SELECT count(*)::int FROM telemetry_events) AS events,
      (SELECT count(*)::int FROM vehicle_latest) AS vehicles,
      (SELECT count(*)::int FROM alerts) AS alerts,
      (SELECT count(*)::int FROM outbox_messages) AS messages`)
      ).rows[0];
    let firstEffects;
    try {
      await sample();
      for (const expected of [
        [1000, 0, 0],
        [0, 1000, 0],
      ]) {
        for (let index = 0; index < 10000; index += 2000) {
          const results = await Promise.all([
            submit(sources.slice(index, index + 1000)),
            submit(sources.slice(index + 1000, index + 2000)),
            coherent(),
          ]);
          for (const receipt of results.slice(0, 2))
            assert.deepEqual([receipt.accepted, receipt.duplicates, receipt.rejected], expected);
        }
        await settled();
        const currentEffects = await effects();
        if (firstEffects)
          assert.deepEqual(
            currentEffects,
            firstEffects,
            'Repetir los 10000 eventos no añade efectos de dominio.',
          );
        else firstEffects = currentEffects;
      }
      await settled();
      await sample();
    } finally {
      stopped = true;
      clearInterval(timer);
      if (sampling) await sampling;
    }
    assert.ok(stats.total > 0);
    if (samplingFailure) throw samplingFailure;
    const fleet = await get('/api/vehicles');
    assert.equal(fleet.total, 100);
    assert.equal(fleet.overallTotal, 100);
    const summary = { OFF: 0, MOVING: 0, STOPPED: 0 };
    for (const current of fleet.items) {
      const number = Number(current.vehicleId.slice(-3));
      const expected = sources[9900 + number];
      assert.equal(current.eventId, expected.eventId);
      const status = !expected.ignitionOn ? 'OFF' : expected.speedKph > 0 ? 'MOVING' : 'STOPPED';
      assert.equal(current.status, status);
      summary[status]++;
    }
    assert.deepEqual(fleet.summary, summary);
    const alerts = await get('/api/alerts');
    assert.equal(alerts.total, 4000);
    assert.equal(new Set(alerts.items.map((a) => a.eventId)).size, 4000);
    const selected = await history('VOLUME-000');
    assert.equal(selected.total, 100);
    assert.deepEqual(
      selected.items.map((e) => e.eventId),
      sources.filter((_, n) => n % 100 === 0).map((e) => e.eventId),
    );
    const counts = (
      await owner.query(`SELECT
      (SELECT count(*)::int FROM telemetry_events) AS events,
      (SELECT count(*)::int FROM vehicle_latest) AS vehicles,
      (SELECT count(*)::int FROM alerts) AS alerts,
      (SELECT count(*)::int FROM ingestion_batches) AS batches,
      (SELECT count(*)::int FROM ingestion_items) AS items,
      (SELECT count(*)::int FROM outbox_messages WHERE type='telemetry.accepted') AS accepted_messages,
      (SELECT count(*)::int FROM outbox_messages WHERE type='alert.created') AS alert_messages`)
    ).rows[0];
    assert.deepEqual(counts, {
      events: 10000,
      vehicles: 100,
      alerts: 4000,
      batches: 20,
      items: 20000,
      accepted_messages: 10000,
      alert_messages: 4000,
    });
    assert.equal(new Set(receipts).size, 20);
    const plan = (
      await runtime.query(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT event_key FROM telemetry_events WHERE vehicle_key=$1 ORDER BY observed_epoch_second,observed_fraction COLLATE "C",event_key',
        [Buffer.from(encodeIdentity('VOLUME-000'))],
      )
    ).rows[0]['QUERY PLAN'][0];
    assert.equal(plan.Plan['Actual Rows'], 100);
    const nodes = [];
    const visit = (node) => {
      nodes.push({
        type: node['Node Type'],
        actualRows: node['Actual Rows'],
        ...(node['Index Name'] ? { index: node['Index Name'] } : {}),
      });
      for (const child of node.Plans ?? []) visit(child);
    };
    visit(plan.Plan);
    globalThis.nexoVolumeMetrics = {
      events: 10000,
      vehicles: 100,
      alerts: 4000,
      batches: 20,
      positions: 20000,
      elapsedMilliseconds: Date.now() - started,
      peakRuntimeConnections: stats.total,
      peakWrites: stats.writes,
      peakQueries: stats.queries,
      peakQueueAndListener: stats.queue,
      queryPlan: {
        planningMilliseconds: plan['Planning Time'],
        executionMilliseconds: plan['Execution Time'],
        nodes,
      },
    };
  },
  async capacity() {
    const held = [];
    const before = await snapshotRows();
    try {
      for (let n = 0; n < 16; n++) {
        const call = http.request(
          {
            hostname: '127.0.0.1',
            port: 3000,
            path: '/api/queries/vehicle-events',
            method: 'POST',
            headers: {
              Host: 'localhost',
              Origin: origin,
              Cookie: cookie,
              'X-CSRF-Token': token,
              'Content-Type': 'application/json',
              'Content-Length': 100,
              Connection: 'close',
            },
          },
          (r) => r.resume(),
        );
        call.on('error', () => {});
        call.write('{');
        held.push(call);
      }
      let probe;
      for (let n = 0; n < 100; n++) {
        probe = await request('/api/vehicles', { proxy: false });
        if (probe.status === 503) break;
        assert.equal(probe.status, 200);
        await pause(10);
      }
      assert.equal(probe.status, 503);
      assert.equal(probe.body.code, 'QUERY_CAPACITY_EXCEEDED');
      const seventeenth = await request('/api/queries/vehicle-events', { raw: '{', proxy: false });
      assert.equal(seventeenth.status, 503);
      assert.equal(seventeenth.body.code, 'QUERY_CAPACITY_EXCEEDED');
    } finally {
      for (const call of held) call.destroy();
    }
    let healthy = false;
    for (let n = 0; n < 100; n++) {
      const read = await request('/api/vehicles', { proxy: false });
      if (read.status === 200) {
        healthy = true;
        break;
      }
      await pause(10);
    }
    assert.equal(healthy, true);
    assert.deepEqual(await snapshotRows(), before);
  },
  async quota() {
    const before = await snapshotRows();
    const started = Date.now();
    for (const [path, options, status] of [
      ['/api/vehicles', {}, 200],
      ['/api/queries/vehicle-events', { raw: '{' }, 400],
    ]) {
      for (let group = 0; group < 30; group++) {
        const responses = await Promise.all(
          Array.from({ length: 10 }, () => request(path, options)),
        );
        for (const response of responses) assert.equal(response.status, status);
      }
    }
    assert.ok(Date.now() - started < 60000, 'La cuota se observa dentro de una ventana.');
    for (const [path, options] of [
      ['/api/vehicles', {}],
      ['/api/queries/vehicle-events', { raw: '{' }],
    ]) {
      const response = await request(path, options);
      assert.equal(response.status, 429);
      assert.equal(response.body.code, 'RATE_LIMITED');
    }
    assert.equal(
      (await request('/api/queries/vehicle-events', { raw: '{', csrf: 'invalid' })).status,
      403,
    );
    assert.deepEqual(await snapshotRows(), before);
  },
  async official() {
    const { fixture, expected } = globalThis.nexoQueryFixture;
    const events = fixture
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    for (const counts of [
      [20, 2, 2],
      [0, 22, 2],
    ]) {
      const receipt = await ingest(events);
      assert.deepEqual([receipt.accepted, receipt.duplicates, receipt.rejected], counts);
      assert.deepEqual(receipt.errors, expected.rejections_at_input_indexes_zero_based);
    }
    await settled();
    const before = await snapshotRows();
    const fleet = await get('/api/vehicles');
    assert.deepEqual([fleet.total, fleet.overallTotal], [8, 8]);
    assert.deepEqual(fleet.summary, { OFF: 0, MOVING: 7, STOPPED: 1 });
    assert.deepEqual(
      Object.fromEntries(fleet.items.map((v) => [v.vehicleId, v.eventId])),
      expected.latest_by_vehicle,
    );
    assert.deepEqual(
      fleet.items.map((v) => v.vehicleId),
      Object.keys(expected.latest_by_vehicle).sort(),
    );
    for (const [vehicleId, ids] of Object.entries(expected.history_by_vehicle_ascending)) {
      const direct = await get(`/api/vehicles/${encodeURIComponent(vehicleId)}/events`);
      assert.deepEqual(direct, await history(vehicleId));
      assert.equal(direct.vehicleId, vehicleId);
      assert.equal(direct.total, ids.length);
      assert.deepEqual(
        direct.items.map((e) => e.eventId),
        ids,
      );
      for (const row of direct.items)
        assert.deepEqual(
          Object.keys(row).sort(),
          [
            'eventId',
            'vehicleId',
            'observedAt',
            'latitude',
            'longitude',
            'speedKph',
            'ignitionOn',
          ].sort(),
        );
    }
    const unknown = { vehicleId: 'unknown', items: [], total: 0 };
    assert.deepEqual(await get('/api/vehicles/unknown/events'), unknown);
    assert.deepEqual(await history('unknown'), unknown);
    const alerts = await get('/api/alerts');
    assert.deepEqual([alerts.total, alerts.overallTotal], [4, 4]);
    assert.deepEqual(
      alerts.items.map((a) => a.eventId).sort(),
      [...expected.overspeed_event_ids].sort(),
    );
    for (const alert of alerts.items) {
      assert.equal(alert.type, 'OVERSPEED');
      assert.ok(alert.speedKph > 80);
      assert.deepEqual(
        Object.keys(alert).sort(),
        ['type', 'eventId', 'vehicleId', 'observedAt', 'latitude', 'longitude', 'speedKph'].sort(),
      );
    }
    assert.deepEqual(
      await get('/api/alerts?vehicleId=VEH-005'),
      alerts,
      'CR-01 no está incorporado en la base.',
    );
    const snapshot = await get('/api/snapshot');
    assert.equal(snapshot.schemaVersion, 1);
    assert.match(snapshot.instanceId, /^[a-f\d-]{36}$/);
    assert.deepEqual(snapshot.vehicles, fleet);
    assert.deepEqual(snapshot.alerts, alerts);
    assert.equal((await get('/api/snapshot')).instanceId, snapshot.instanceId);
    const filtered = await get('/api/vehicles?q=veh-001');
    assert.equal(filtered.total, 1);
    assert.equal(filtered.overallTotal, 8);
    assert.deepEqual(filtered.summary, fleet.summary);
    assert.equal((await get('/api/vehicles?q=unknown')).total, 0);
    assert.deepEqual(
      await snapshotRows(),
      before,
      'GET/POST de consulta no alteran dominio, recibos o jobs.',
    );
    assert.equal((await owner.query('SELECT count(*) FROM outbox_messages')).rows[0].count, '43');
  },
  async adversarial() {
    const vehicleId = 'x'.repeat(12000) + '\u0000\ud800';
    const a = event({
      vehicleId,
      eventId: 'a\ud800',
      observedAt: '2026-01-01T01:00:00.1234567890001+01:00',
      speedKph: 0,
    });
    const z = event({
      vehicleId,
      eventId: 'z',
      observedAt: '2026-01-01T00:00:00.1234567890001Z',
      speedKph: 82,
    });
    const late = event({
      vehicleId,
      eventId: 'late',
      observedAt: '2026-01-01T00:00:00.123456789Z',
      speedKph: 95,
      ignitionOn: false,
    });
    const literal = event({ vehicleId: 'A_%', eventId: 'literal', speedKph: 0 });
    const caseSensitive = event({ vehicleId: 'a_%', eventId: 'lowercase', speedKph: 0 });
    assert.equal((await ingest([z, a, late, literal, caseSensitive])).accepted, 5);
    const exact = await history(vehicleId);
    assert.deepEqual(
      exact.items.map((e) => e.eventId),
      ['late', 'a\ud800', 'z'],
    );
    assert.equal(exact.items[1].observedAt, '2026-01-01T00:00:00.1234567890001Z');
    const fleet = await get('/api/vehicles');
    assert.equal(fleet.items.find((v) => v.vehicleId === vehicleId).eventId, 'z');
    assert.equal((await history(vehicleId.toUpperCase())).total, 0);
    const filtered = await get('/api/vehicles?q=' + encodeURIComponent('a_%'));
    assert.deepEqual(
      filtered.items.map((v) => v.vehicleId),
      ['A_%', 'a_%'],
    );
    assert.equal(filtered.total, 2);
    assert.equal(filtered.overallTotal, 3);
    assert.equal((await get('/api/vehicles?q=' + encodeURIComponent('%'))).total, 2);
    for (const proxy of [true, false]) {
      const exactBody = '{"vehicleId":"unknown"}'.padEnd(2 * 1024 * 1024);
      const valid = await request('/api/queries/vehicle-events', { raw: exactBody, proxy });
      assert.equal(valid.status, 200);
      assert.equal(valid.body.total, 0);
      assert.equal(
        (await request('/api/queries/vehicle-events', { raw: exactBody + ' ', proxy })).status,
        413,
      );
      assert.equal(
        (await request('/api/queries/vehicle-events', { raw: '{', proxy })).body.code,
        'MALFORMED_JSON',
      );
      assert.equal(
        (
          await request('/api/queries/vehicle-events', {
            raw: '{',
            proxy,
            requestOrigin: 'http://foreign.invalid',
          })
        ).status,
        403,
      );
      assert.equal(
        (await request('/api/queries/vehicle-events', { raw: '{', proxy, csrf: 'invalid' })).status,
        403,
      );
      assert.equal(
        (
          await request('/api/queries/vehicle-events', {
            raw: '{',
            proxy,
            authenticated: false,
            key: true,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/queries/vehicle-events', {
            raw: '{}',
            proxy,
            headers: { 'Content-Type': 'text/plain' },
          })
        ).status,
        415,
      );
      assert.equal(
        (await request('/api/queries/vehicle-events', { raw: Buffer.from([0xc3, 0x28]), proxy }))
          .status,
        400,
      );
    }
    assert.equal((await request('/api/vehicles?q=a&q=b')).status, 400);
    assert.equal((await request('/api/vehicles?q[x]=a')).status, 400);
    const plan = (
      await runtime.query(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT event_key FROM telemetry_events WHERE vehicle_key=$1 ORDER BY observed_epoch_second,observed_fraction COLLATE "C",event_key',
        [Buffer.from(encodeIdentity(vehicleId))],
      )
    ).rows[0]['QUERY PLAN'][0];
    assert.equal(plan.Plan['Actual Rows'], 3);
  },
  async snapshot() {
    await ingest([event({ vehicleId: 'first' })]);
    let injected = false;
    const originalConnect = runtime.connect.bind(runtime);
    const pool = {
      connect: async () => {
        const client = await originalConnect();
        return new Proxy(client, {
          get(target, property) {
            if (property === 'query')
              return async (text, ...args) => {
                const result = await target.query(text, ...args);
                if (typeof text === 'string' && text.includes('FROM vehicle_latest') && !injected) {
                  assert.equal(
                    (await target.query('SHOW transaction_read_only')).rows[0]
                      .transaction_read_only,
                    'on',
                  );
                  assert.equal(
                    (await target.query('SHOW transaction_isolation')).rows[0]
                      .transaction_isolation,
                    'repeatable read',
                  );
                  injected = true;
                  await ingest([event({ vehicleId: 'second' })]);
                }
                return result;
              };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    const before = await new PostgresReadModel(pool).snapshot();
    assert.equal(injected, true);
    assert.equal(before.vehicles.length, 1);
    assert.equal(before.alerts.length, 1);
    const after = await get('/api/snapshot');
    assert.equal(after.vehicles.total, 2);
    assert.equal(after.alerts.total, 2);
    await settled();
    const rows = await snapshotRows();
    for (let n = 0; n < 10; n++) await get('/api/snapshot');
    assert.deepEqual(await snapshotRows(), rows);
  },
};
try {
  await login();
  const scenario = process.env.NEXO_QUERY_CASE;
  assert.ok(Object.hasOwn(cases, scenario));
  await cases[scenario]();
  if (scenario === 'volume')
    console.log(
      JSON.stringify({ status: 'queries-volume-ok', metrics: globalThis.nexoVolumeMetrics }),
    );
  else console.log('queries-case-ok');
} finally {
  await owner.end();
  await runtime.end();
}
