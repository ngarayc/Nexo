import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { ClassifyTelemetry } from '/app/apps/api/dist/modules/telemetry/application/classify.js';
import { TelemetryTransaction } from '/app/apps/api/dist/modules/telemetry/adapters/postgres/telemetry-transaction.js';
import { OriginalJson } from '/app/apps/api/dist/modules/telemetry/domain/original-json.js';
import {
  encodeIdentity,
  decodeIdentity,
} from '/app/apps/api/dist/modules/telemetry/domain/identity.js';
import { vehicleState } from '/app/apps/api/dist/modules/telemetry/domain/event.js';
import { changeFrame } from '/app/apps/api/dist/modules/telemetry/application/change-message.js';

const { fixture, expected } = globalThis.nexoClassificationInputs;
const pool = new Pool(readDatabaseConfig(process.env).pool);
const db = drizzle(pool);
const classifier = new ClassifyTelemetry();
const key = (value) => Buffer.from(encodeIdentity(value));
const input = (source) =>
  OriginalJson.parse(typeof source === 'string' ? source : JSON.stringify(source));
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
const classify = (source) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL transaction_timeout='10s'`);
    return classifier.execute(input(source), new TelemetryTransaction(tx));
  });
async function counts() {
  return (
    await pool.query(`SELECT
    (SELECT count(*)::int FROM telemetry_events) AS events,
    (SELECT count(*)::int FROM vehicle_latest) AS vehicles,
    (SELECT count(*)::int FROM alerts) AS alerts,
    (SELECT count(*)::int FROM outbox_messages) AS messages`)
  ).rows[0];
}
async function latest(vehicleId) {
  const row = (
    await pool.query(
      `SELECT e.event_key FROM vehicle_latest v
    JOIN telemetry_events e ON e.event_pk=v.event_pk WHERE v.vehicle_key=$1`,
      [key(vehicleId)],
    )
  ).rows[0];
  return row ? decodeIdentity(row.event_key) : undefined;
}
const cases = {
  async oracles() {
    const inputs = fixture.trim().split('\n');
    for (const run of [1, 2]) {
      const results = [];
      for (const source of inputs) results.push(await classify(source));
      assert.deepEqual(
        {
          accepted: results.filter((r) => r.outcome === 'accepted').length,
          duplicates: results.filter((r) => r.outcome === 'duplicate').length,
          rejected: results.filter((r) => r.outcome === 'rejected').length,
        },
        run === 1
          ? { accepted: 20, duplicates: 2, rejected: 2 }
          : { accepted: 0, duplicates: 22, rejected: 2 },
      );
      const rejections = results.flatMap((r, index) =>
        r.outcome === 'rejected'
          ? [
              {
                index,
                eventId: input(inputs[index]).property('eventId').stringValue,
                reason: r.reason,
              },
            ]
          : [],
      );
      assert.deepEqual(rejections, expected.rejections_at_input_indexes_zero_based);
      if (run === 1)
        assert.deepEqual(
          results.flatMap((r, index) =>
            r.outcome === 'duplicate'
              ? [{ index, eventId: input(inputs[index]).property('eventId').stringValue }]
              : [],
          ),
          expected.duplicates_at_input_indexes_zero_based,
        );
      assert.deepEqual(await counts(), { events: 20, vehicles: 8, alerts: 4, messages: 43 });
    }
    const events = await pool.query('SELECT event_key FROM telemetry_events');
    assert.deepEqual(
      events.rows.map((r) => decodeIdentity(r.event_key)).sort(),
      [...expected.accepted_event_ids].sort(),
    );
    for (const [vehicleId, eventId] of Object.entries(expected.latest_by_vehicle))
      assert.equal(await latest(vehicleId), eventId);
    const states = await pool.query(
      `SELECT e.ignition_on AS "ignitionOn",e.speed_kph AS "speedKph" FROM vehicle_latest v JOIN telemetry_events e ON e.event_pk=v.event_pk`,
    );
    assert.deepEqual(states.rows.map(vehicleState).sort(), [
      'MOVING',
      'MOVING',
      'MOVING',
      'MOVING',
      'MOVING',
      'MOVING',
      'MOVING',
      'STOPPED',
    ]);
    const alerts = await pool.query(
      'SELECT e.event_key FROM alerts a JOIN telemetry_events e ON a.event_pk=e.event_pk',
    );
    assert.deepEqual(
      alerts.rows.map((r) => decodeIdentity(r.event_key)).sort(),
      [...expected.overspeed_event_ids].sort(),
    );
    const messages = await pool.query('SELECT payload::text,frame_bytes FROM outbox_messages');
    const types = {};
    for (const row of messages.rows) {
      const message = JSON.parse(row.payload);
      types[message.type] = (types[message.type] ?? 0) + 1;
      assert.equal(row.frame_bytes, Buffer.byteLength(changeFrame(message)));
      assert.equal(message.schemaVersion, 1);
      assert.match(message.messageId, /^[a-f0-9-]{36}$/);
      assert.equal(message.data.eventId, message.eventId);
    }
    assert.deepEqual(types, {
      'telemetry.accepted': 20,
      'vehicle.updated': 19,
      'alert.created': 4,
    });
  },
  async rollback() {
    for (const stage of ['promoteLatest', 'createAlert', 'append']) {
      const source = event();
      const before = await counts();
      await assert.rejects(
        db.transaction(async (tx) => {
          const effects = new TelemetryTransaction(tx);
          const actual = effects[stage].bind(effects);
          effects[stage] = async (...args) => {
            await actual(...args);
            throw Error('ROLLBACK_EXPECTED');
          };
          await classifier.execute(input(source), effects);
        }),
        { message: 'ROLLBACK_EXPECTED' },
      );
      assert.deepEqual(await counts(), before);
      assert.equal(await latest(source.vehicleId), undefined);
      assert.equal(
        (
          await pool.query('SELECT count(*) FROM telemetry_events WHERE event_key=$1', [
            key(source.eventId),
          ])
        ).rows[0].count,
        '0',
      );
    }
  },
  async identity() {
    const source = event({
      eventId: 'E\u0000\ud800🚐',
      vehicleId: 'V\u0000\udfff',
      observedAt: '2026-01-01T00:00:00.000000000001Z',
      speedKph: 95,
      ignitionOn: false,
    });
    const raw =
      JSON.stringify(source).slice(0, -1) + ',"big":9007199254740993,"meta":{"__proto__":1e400}}';
    assert.equal((await classify(raw)).outcome, 'accepted');
    const same = raw
      .replace('9007199254740993', '90071992547409930e-1')
      .replace('1e400', '10e399')
      .replace('2026-01-01T00:00:00.000000000001Z', '2025-12-31T19:00:00.000000000001-05:00');
    assert.equal((await classify(same)).outcome, 'duplicate');
    assert.deepEqual(await classify(raw.replace('9007199254740993', '9007199254740992')), {
      outcome: 'rejected',
      reason: 'EVENT_ID_CONFLICT',
    });
    assert.equal(await latest(source.vehicleId), source.eventId);
    const stored = (
      await pool.query(
        'SELECT payload_extra::text,observed_at_original FROM telemetry_events WHERE event_key=$1',
        [key(source.eventId)],
      )
    ).rows[0];
    assert.equal(
      OriginalJson.parse(stored.payload_extra).equals(
        OriginalJson.parse('{"big":9007199254740993,"meta":{"__proto__":1e400}}'),
      ),
      true,
    );
    assert.equal(stored.observed_at_original, source.observedAt);
    const message = (
      await pool.query(
        'SELECT payload::text FROM outbox_messages WHERE event_pk=(SELECT event_pk FROM telemetry_events WHERE event_key=$1) AND type=$2',
        [key(source.eventId), 'vehicle.updated'],
      )
    ).rows[0];
    assert.equal(JSON.parse(message.payload).data.state, 'OFF');
    assert.equal(Object.hasOwn(JSON.parse(message.payload).data, 'big'), false);
    for (const speedKph of [80, 81]) {
      const sample = event({ speedKph });
      await classify(sample);
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM alerts a JOIN telemetry_events e ON e.event_pk=a.event_pk WHERE e.event_key=$1',
            [key(sample.eventId)],
          )
        ).rows[0].n,
        speedKph === 81 ? 1 : 0,
      );
    }
    for (const eventId of [
      'A' + String.fromCodePoint(14831),
      'A' + String.fromCodePoint(188551),
      'L'.repeat(20000),
    ]) {
      const sample = event({ eventId, vehicleId: eventId });
      assert.equal((await classify(sample)).outcome, 'accepted');
      assert.equal((await classify(sample)).outcome, 'duplicate');
      assert.equal(await latest(eventId), eventId);
    }
  },
  async races() {
    const same = event();
    const before = await counts();
    const results = await Promise.all([classify(same), classify(same)]);
    assert.deepEqual(results.map((r) => r.outcome).sort(), ['accepted', 'duplicate']);
    const after = await counts();
    assert.deepEqual(after, {
      events: before.events + 1,
      vehicles: before.vehicles + 1,
      alerts: before.alerts + 1,
      messages: before.messages + 3,
    });
    const conflict = event();
    const conflicting = await Promise.all([
      classify(conflict),
      classify({ ...conflict, speedKph: 82 }),
    ]);
    assert.deepEqual(conflicting.map((r) => r.outcome).sort(), ['accepted', 'rejected']);
    assert.equal(conflicting.find((r) => r.outcome === 'rejected').reason, 'EVENT_ID_CONFLICT');
    const vehicleId = randomUUID();
    const samples = [
      event({
        eventId: 'tie-' + String.fromCodePoint(0xe000),
        vehicleId,
        observedAt: '2026-01-01T00:00:00.000000000002Z',
      }),
      event({
        eventId: 'tie-' + String.fromCodePoint(0x10000),
        vehicleId,
        observedAt: '2026-01-01T00:00:00.000000000002Z',
      }),
      event({ eventId: randomUUID(), vehicleId, observedAt: '2026-01-01T00:00:00.000000000001Z' }),
    ];
    assert.deepEqual(
      (await Promise.all(samples.map(classify))).map((r) => r.outcome),
      ['accepted', 'accepted', 'accepted'],
    );
    assert.equal(await latest(vehicleId), samples[1].eventId);
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM telemetry_events WHERE vehicle_key=$1', [
          key(vehicleId),
        ])
      ).rows[0].n,
      3,
    );
  },
};
try {
  assert.equal(Object.hasOwn(cases, process.env.NEXO_CLASSIFICATION_CASE), true);
  await cases[process.env.NEXO_CLASSIFICATION_CASE]();
  console.log('classification-case-ok');
} finally {
  await pool.end();
}
