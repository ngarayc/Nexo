import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { ClassifyTelemetry } from '/app/apps/api/dist/modules/telemetry/application/classify.js';
import { TelemetryTransaction } from '/app/apps/api/dist/modules/telemetry/adapters/postgres/telemetry-transaction.js';
import { OriginalJson } from '/app/apps/api/dist/modules/telemetry/domain/original-json.js';
import {
  DispatchOutbox,
  OutboxReadiness,
  selectGroup,
} from '/app/apps/api/dist/modules/realtime/application/dispatch.js';
import { PostgresOutboxStore } from '/app/apps/api/dist/modules/realtime/adapters/postgres/outbox-store.js';
import { storedFrame } from '/app/apps/api/dist/modules/realtime/adapters/postgres/stored-frame.js';

const config = readDatabaseConfig(process.env).pool;
const pool = new Pool({ ...config, max: 1 });
const writes = new Pool({ ...config, max: 2 });
const db = drizzle(writes);
const store = new PostgresOutboxStore(pool);
const signal = new globalThis.AbortController().signal;
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
const classifier = new ClassifyTelemetry();
const classify = (source, tx) =>
  classifier.execute(OriginalJson.parse(JSON.stringify(source)), new TelemetryTransaction(tx));
const seed = (source) => db.transaction((tx) => classify(source, tx));
const frameId = (frame) => frame.split('\n')[0].slice(3);
function dispatcher(actualStore = store, delivered = []) {
  return new DispatchOutbox(
    actualStore,
    storedFrame,
    (frame) => {
      assert.equal(
        pool.totalCount,
        pool.idleCount,
        'El dispatcher no retiene conexión SQL durante distribución local.',
      );
      delivered.push(frameId(frame));
    },
    new OutboxReadiness(),
  );
}
const pending = async () =>
  (await pool.query('SELECT count(*)::int AS n FROM outbox_messages WHERE published_at IS NULL'))
    .rows[0].n;
async function drain(run) {
  for (let n = 0; n < 100; n++) if (!(await run.group(signal))) return;
  throw new Error('El dispatcher no terminó los grupos de prueba.');
}
const cases = {
  async confirmed() {
    for (let i = 0; i < 35; i++) assert.equal((await seed(event())).outcome, 'accepted');
    assert.equal(await pending(), 105);
    const delivered = [];
    const original = store.publish.bind(store);
    store.publish = async (ids) => {
      await original(ids);
      throw new Error('synthetic-reply-lost-after-durable-update');
    };
    const run = dispatcher(store, delivered);
    try {
      await drain(run);
    } finally {
      store.publish = original;
    }
    assert.equal(delivered.length, 105);
    assert.equal(new Set(delivered).size, 105);
    assert.equal(await pending(), 0);
    assert.equal(run.readiness.healthy, true);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM outbox_messages WHERE attempts<>0 OR last_error_code IS NOT NULL',
        )
      ).rows[0].n,
      0,
    );
    const restarted = [];
    await drain(dispatcher(new PostgresOutboxStore(pool), restarted));
    assert.equal(restarted.length, 0);
  },
  async retry() {
    await seed(event());
    const delivered = [];
    const original = store.publish.bind(store);
    store.publish = async () => {
      throw new Error('synthetic-before-mark');
    };
    try {
      await dispatcher(store, delivered).group(signal);
    } finally {
      store.publish = original;
    }
    const first = [...delivered];
    assert.equal(first.length, 3);
    const state = (
      await pool.query(
        `SELECT message_id,attempts,last_error_code,extract(epoch FROM available_at-clock_timestamp())::float8 AS seconds FROM outbox_messages WHERE published_at IS NULL`,
      )
    ).rows;
    assert.equal(state.length, 3);
    for (const row of state) {
      assert.equal(row.attempts, 1);
      assert.equal(row.last_error_code, 'OUTBOX_MARK_UNCONFIRMED');
      assert.ok(row.seconds > 0 && row.seconds <= 1.25);
    }
    // El backoff de las primeras filas no impide que se publique trabajo nuevo.
    await seed(event());
    const next = [];
    await dispatcher(store, next).group(signal);
    assert.equal(next.length, 3);
    assert.ok(next.every((id) => !first.includes(id)));
    await pause(1300);
    await dispatcher(store, delivered).group(signal);
    assert.deepEqual(delivered.slice(3).sort(), [...first].sort());
    assert.equal(await pending(), 0);
    // Se verifica el backoff SQL, incluidos jitter, saturación y ausencia de descarte.
    await seed(event());
    const selected = await store.metadata();
    const ids = selected.map((row) => row.messageId);
    for (let attempt = 0; attempt < 8; attempt++) {
      await store.fail(ids, 'OUTBOX_PUBLICATION_FAILED');
      const rows = (
        await pool.query(
          `SELECT attempts,extract(epoch FROM available_at-clock_timestamp())::float8 AS seconds,published_at FROM outbox_messages WHERE message_id=ANY($1::uuid[])`,
          [ids],
        )
      ).rows;
      const base = Math.min(30, 2 ** attempt),
        cap = Math.min(30, base * 1.25);
      for (const row of rows) {
        assert.equal(row.attempts, attempt + 1);
        assert.equal(row.published_at, null);
        assert.ok(row.seconds >= base - 0.25 && row.seconds <= cap);
      }
    }
    // La publicación posterior sigue siendo posible, sin borrar la fila retenida.
    await store.publish(ids);
    assert.equal(await pending(), 0);
  },
  async late() {
    const before = (await pool.query('SELECT count(*)::int AS n FROM outbox_messages')).rows[0].n;
    await assert.rejects(
      db.transaction(async (tx) => {
        await classify(event(), tx);
        throw new Error('synthetic-rollback');
      }),
      { message: 'synthetic-rollback' },
    );
    const rollback = [];
    await drain(dispatcher(store, rollback));
    assert.equal(rollback.length, 0);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM outbox_messages')).rows[0].n,
      before,
    );
    let inserted, commit;
    const insertedPromise = new Promise((resolve) => {
      inserted = resolve;
    });
    const commitPromise = new Promise((resolve) => {
      commit = resolve;
    });
    const late = db.transaction(async (tx) => {
      await classify(event(), tx);
      inserted();
      await commitPromise;
    });
    try {
      await insertedPromise;
      assert.equal(await pending(), 0);
      await seed(event());
      const early = [];
      await drain(dispatcher(store, early));
      assert.equal(early.length, 3);
      commit();
      await late;
      const after = [];
      await drain(dispatcher(store, after));
      assert.equal(after.length, 3);
      assert.ok(after.every((id) => !early.includes(id)));
      assert.equal(await pending(), 0);
    } finally {
      commit();
      await late;
    }
  },
  async sizes() {
    for (let i = 0; i < 35; i++) await seed(event());
    const metadata = await store.metadata();
    assert.equal(metadata.length, 100);
    assert.ok(
      metadata.every(
        (row) => Object.keys(row).sort().join(',') === 'frameBytes,messageId,schemaVersion,type',
      ),
    );
    const loaded = [];
    const original = store.payloads.bind(store);
    store.payloads = async (ids) => {
      loaded.push([...ids]);
      return original(ids);
    };
    try {
      await drain(dispatcher());
    } finally {
      store.payloads = original;
    }
    assert.deepEqual(
      loaded.map((ids) => ids.length),
      [100, 5],
    );
    const free = '\n\revent:injected\u0000\ud800🚐';
    const id = free + 'x'.repeat(600000);
    await seed(event({ eventId: id, vehicleId: id, speedKph: 0 }));
    await seed(event());
    const current = await store.metadata();
    assert.equal(current.length, 5);
    assert.ok(current[0].frameBytes > 2 * 1024 * 1024);
    assert.equal(selectGroup(current).length, 1, 'La primera trama mayor va sola.');
    const groups = [];
    store.payloads = async (ids) => {
      groups.push([...ids]);
      return original(ids);
    };
    const frames = [];
    const run = new DispatchOutbox(
      store,
      (row, payload) => {
        const frame = storedFrame(row, payload);
        assert.equal(Buffer.byteLength(frame), row.frameBytes);
        // Los IDs libres permanecen dentro del JSON. Solo existen los tres campos SSE.
        assert.equal(frame.split('\n').length, 5);
        assert.ok(frame.startsWith('id:'));
        frames.push(frame);
        return frame;
      },
      () => {
        assert.equal(pool.totalCount, pool.idleCount);
      },
      new OutboxReadiness(),
    );
    try {
      await drain(run);
    } finally {
      store.payloads = original;
    }
    assert.deepEqual(
      groups.map((ids) => ids.length),
      [1, 1, 3],
    );
    assert.equal(frames.length, 5);
    assert.equal(frames.filter((frame) => Buffer.byteLength(frame) > 2 * 1024 * 1024).length, 2);
    assert.equal(await pending(), 0);
  },
};
try {
  assert.ok(Object.hasOwn(cases, process.env.NEXO_OUTBOX_CASE));
  await cases[process.env.NEXO_OUTBOX_CASE]();
  console.log('outbox-case-ok');
} finally {
  await Promise.all([pool.end(), writes.end()]);
}
