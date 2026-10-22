import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as pause } from 'node:timers/promises';
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';

const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const channels = [];
const origin = process.env.PUBLIC_ORIGIN;
const event = () => ({
  eventId: randomUUID(),
  vehicleId: randomUUID(),
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph: 81,
  ignitionOn: true,
});
async function request(
  path,
  {
    session,
    body,
    key = false,
    method = body === undefined ? 'GET' : 'POST',
    requestOrigin = origin,
  } = {},
) {
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const call = http.request(
      {
        hostname: 'web',
        port: 8080,
        path,
        method,
        signal: globalThis.AbortSignal.timeout(90000),
        headers: {
          Host: 'localhost',
          Connection: 'close',
          ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.token } : {}),
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
          ...(key ? { 'X-API-Key': process.env.INGEST_API_KEY } : {}),
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
            });
          } catch {
            reject(new Error('Respuesta JSON no comprobable.'));
          }
        });
      },
    );
    call.on('error', reject);
    call.end(bytes);
  });
}
async function login() {
  const result = await request('/api/session', { body: { username: 'demo', password: 'demo' } });
  assert.equal(result.status, 200);
  return { cookie: result.headers['set-cookie'][0].split(';')[0], token: result.body.csrfToken };
}
async function until(predicate, message, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  do {
    if (await predicate()) return;
    await pause(20);
  } while (Date.now() < deadline);
  throw new Error(message);
}
async function open(session, headers = {}) {
  let resolveReady, rejectReady, response;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const channel = {
    frames: [],
    closed: false,
    error: undefined,
    ready: undefined,
    stop: () => {
      call.destroy();
      response?.destroy();
    },
  };
  const deadline = globalThis.setTimeout(() => {
    rejectReady(new Error('No llegó stream.ready.'));
    channel.stop();
  }, 10000);
  const call = http.request(
    {
      hostname: 'web',
      port: 8080,
      path: '/api/stream',
      headers: { Host: 'localhost', Cookie: session.cookie, ...headers },
    },
    (incoming) => {
      response = incoming;
      const decoder = new StringDecoder('utf8');
      let buffer = '';
      if (incoming.statusCode !== 200) {
        rejectReady(new Error('No se pudo abrir SSE.'));
        channel.stop();
        return;
      }
      assert.match(incoming.headers['content-type'], /^text\/event-stream/);
      assert.equal(incoming.headers['cache-control'], 'private, no-store, no-transform');
      assert.equal(incoming.headers['content-encoding'], undefined);
      incoming.on('data', (chunk) => {
        try {
          buffer += decoder.write(chunk);
          assert.ok(Buffer.byteLength(buffer) <= 4 * 1024 * 1024);
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const values = Object.fromEntries(
              block.split('\n').map((line) => {
                const colon = line.indexOf(':');
                return [line.slice(0, colon), line.slice(colon + 1)];
              }),
            );
            const body = JSON.parse(values.data);
            if (!channel.ready) {
              assert.equal(values.event, 'stream.ready');
              assert.equal(body.type, 'stream.ready');
              assert.equal(body.schemaVersion, 1);
              assert.equal(body.heartbeatMilliseconds, 15000);
              channel.ready = body;
              globalThis.clearTimeout(deadline);
              resolveReady(channel);
            } else channel.frames.push({ id: values.id, event: values.event, body });
          }
        } catch (error) {
          channel.error = error;
          rejectReady(error);
          channel.stop();
        }
      });
      incoming.on('error', () => {
        channel.closed = true;
      });
      incoming.on('close', () => {
        channel.closed = true;
        globalThis.clearTimeout(deadline);
        if (!channel.ready) rejectReady(new Error('SSE cerrado antes de ready.'));
      });
    },
  );
  call.on('error', () => {
    channel.closed = true;
    globalThis.clearTimeout(deadline);
    if (!channel.ready) rejectReady(new Error('Fallo al conectar SSE.'));
  });
  channels.push(channel);
  call.end();
  return ready;
}
const domain = (channel) =>
  new Map(
    channel.frames
      .filter((frame) =>
        ['telemetry.accepted', 'vehicle.updated', 'alert.created'].includes(frame.event),
      )
      .map((frame) => [frame.id, frame]),
  );
async function waitMessages(channel, count) {
  await until(() => {
    if (channel.error) throw channel.error;
    if (domain(channel).size >= count) return true;
    if (channel.closed) throw new Error('SSE cerrado antes de recibir el dominio esperado.');
    return false;
  }, 'No llegaron los mensajes esperados.');
}
async function ingest(events) {
  const result = await request('/api/events/batch', { key: true, body: { events } });
  assert.equal(result.status, 200);
  return result.body;
}
async function allPublished() {
  await until(
    async () =>
      (
        await owner.query(
          'SELECT count(*)::int AS n FROM outbox_messages WHERE published_at IS NULL',
        )
      ).rows[0].n === 0,
    'Outbox no terminó de publicar.',
  );
}
const cases = {
  async heartbeat() {
    const session = await login();
    const channel = await open(session, { 'Accept-Encoding': 'gzip' });
    await until(
      () => channel.frames.some((frame) => frame.event === 'stream.heartbeat'),
      'No llegó heartbeat por el proxy.',
      20000,
    );
    const control = channel.frames.find((frame) => frame.event === 'stream.heartbeat');
    assert.equal(control.id, undefined);
    assert.equal(control.body.instanceId, channel.ready.instanceId);
    assert.equal(control.body.schemaVersion, 1);
    assert.equal(channel.closed, false);
    await ingest([event()]);
    await waitMessages(channel, 3);
  },
  async official() {
    const a = await login(),
      b = await login();
    const first = await open(a),
      second = await open(b);
    assert.equal(first.ready.instanceId, second.ready.instanceId);
    const { fixture, expected } = globalThis.nexoRealtimeFixture;
    const events = fixture
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    for (const counts of [
      [20, 2, 2],
      [0, 22, 2],
    ]) {
      const result = await ingest(events);
      assert.deepEqual([result.accepted, result.duplicates, result.rejected], counts);
      await waitMessages(first, 43);
      await waitMessages(second, 43);
      await allPublished();
      assert.equal(
        (await owner.query('SELECT count(*)::int AS n FROM outbox_messages')).rows[0].n,
        43,
      );
    }
    for (const channel of [first, second]) {
      const messages = [...domain(channel).values()];
      assert.equal(messages.length, 43);
      assert.deepEqual(
        messages
          .filter((m) => m.event === 'telemetry.accepted')
          .map((m) => m.body.eventId)
          .sort(),
        Object.values(expected.history_by_vehicle_ascending).flat().sort(),
      );
      assert.deepEqual(
        messages
          .filter((m) => m.event === 'alert.created')
          .map((m) => m.body.eventId)
          .sort(),
        [...expected.overspeed_event_ids].sort(),
      );
      const updates = messages.filter((m) => m.event === 'vehicle.updated');
      assert.equal(updates.length, 19);
      assert.ok(!updates.some((m) => m.body.eventId === 'E-001-00'));
      for (const frame of messages) {
        assert.equal(frame.id, frame.body.messageId);
        assert.equal(frame.event, frame.body.type);
      }
    }
    assert.deepEqual([...domain(first).keys()].sort(), [...domain(second).keys()].sort());
    const snapshot = await request('/api/snapshot', { session: a });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.instanceId, first.ready.instanceId);
    assert.deepEqual([snapshot.body.vehicles.total, snapshot.body.alerts.total], [8, 4]);
    first.stop();
    await until(() => first.closed, 'No cerró el cliente.');
    const resumed = await open(a, { 'Last-Event-ID': [...domain(first).keys()][0] });
    await pause(500);
    assert.equal(domain(resumed).size, 0, 'Last-Event-ID no contrata retransmisión histórica.');
  },
  async sessions() {
    const a = await login(),
      b = await login();
    const first = await open(a),
      second = await open(b);
    await ingest([event()]);
    await waitMessages(first, 3);
    await waitMessages(second, 3);
    assert.equal((await request('/api/session', { session: a, method: 'DELETE' })).status, 204);
    await until(() => first.closed, 'Logout no cerró el stream.');
    assert.equal(second.closed, false);
    await ingest([event()]);
    await waitMessages(second, 6);
    const own = [second];
    for (let i = 0; i < 3; i++) own.push(await open(b));
    assert.equal(
      (await request('/api/stream', { session: b })).body.code,
      'STREAM_CAPACITY_EXCEEDED',
    );
    for (let account = 0; account < 3; account++) {
      const session = await login();
      for (let n = 0; n < 4; n++) await open(session);
    }
    const extra = await login();
    assert.equal(
      (await request('/api/stream', { session: extra })).body.code,
      'STREAM_CAPACITY_EXCEEDED',
    );
    own[0].stop();
    await until(() => own[0].closed, 'No cerró el cliente que libera cupo.');
    await pause(30);
    const replacement = await open(extra);
    assert.equal(replacement.closed, false);
  },
  async quota() {
    const session = await login();
    assert.equal((await request('/api/stream')).status, 403);
    assert.equal((await request('/api/stream', { key: true })).status, 403);
    assert.equal(
      (await request('/api/stream', { session, requestOrigin: 'http://foreign.invalid' })).status,
      403,
    );
    for (let n = 0; n < 30; n++) {
      const channel = await open(session);
      channel.stop();
      await until(() => channel.closed, 'No cerró la apertura de prueba.');
      await pause(20);
    }
    const limited = await request('/api/stream', { session });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.equal(
      (await request('/api/vehicles', { session })).status,
      200,
      'La cuota SSE es independiente de lectura.',
    );
  },
  async degradation() {
    const session = await login(),
      channel = await open(session);
    const before = channel.ready.instanceId;
    await owner.query(`CREATE FUNCTION nexo_test_publish_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-publish-failure'; END $$;
      CREATE TRIGGER nexo_test_publish_failure BEFORE UPDATE OF published_at ON outbox_messages FOR EACH ROW WHEN (NEW.published_at IS NOT NULL) EXECUTE FUNCTION nexo_test_publish_failure()`);
    try {
      await ingest([event()]);
      await until(
        async () =>
          (
            await owner.query(
              'SELECT count(*)::int AS n FROM outbox_messages WHERE last_error_code IS NOT NULL',
            )
          ).rows[0].n > 0,
        'No se conservó el fallo de publicación.',
      );
      await until(() => channel.closed, 'La degradación no cerró el stream.');
      assert.equal((await request('/api/health')).status, 503);
      assert.equal((await request('/api/stream', { session })).status, 503);
      assert.equal((await request('/api/vehicles', { session })).status, 200);
      const second = await ingest([event()]);
      assert.equal(
        second.accepted,
        1,
        'Ingesta sigue admitiendo durante degradación del dispatcher.',
      );
    } finally {
      await owner.query(
        'DROP TRIGGER nexo_test_publish_failure ON outbox_messages; DROP FUNCTION nexo_test_publish_failure()',
      );
    }
    await allPublished();
    await until(async () => (await request('/api/health')).status === 200, 'No recuperó salud.');
    const next = await open(session);
    assert.notEqual(next.ready.instanceId, before);
    const snapshot = await request('/api/snapshot', { session });
    assert.equal(snapshot.body.instanceId, next.ready.instanceId);
    assert.equal(snapshot.body.vehicles.total, 2);
    assert.equal(
      (
        await owner.query(
          'SELECT count(*)::int AS n FROM outbox_messages WHERE attempts>0 AND published_at IS NOT NULL',
        )
      ).rows[0].n > 0,
      true,
    );
  },
};
try {
  const scenario = process.env.NEXO_REALTIME_CASE;
  assert.ok(Object.hasOwn(cases, scenario));
  await cases[scenario]();
  console.log('realtime-case-ok');
} finally {
  for (const channel of channels) channel.stop();
  await owner.end();
}
