// Casos ejecutados en la imagen API y en su PostgreSQL sintético, nunca en la demo.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from 'argon2';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { prepareDatabase } from '/app/apps/api/dist/platform/database/prepare.js';
import { passwordHashOptions } from '/app/apps/api/dist/platform/database/password-policy.js';
import {
  telemetryEvents,
  alerts,
  vehicleLatest,
  ingestionBatches,
  ingestionItems,
  outboxMessages,
  users,
} from '/app/apps/api/dist/platform/database/schema.js';
import {
  encodeIdentity,
  decodeIdentity,
} from '/app/apps/api/dist/modules/telemetry/domain/identity.js';
import {
  readObservedInstant,
  compareObservedInstant,
} from '/app/apps/api/dist/modules/telemetry/domain/observed-instant.js';
import { OriginalJson } from '/app/apps/api/dist/modules/telemetry/domain/original-json.js';
import { validateEvent } from '/app/apps/api/dist/modules/telemetry/domain/event.js';
import {
  changeMessage,
  changeFrame,
} from '/app/apps/api/dist/modules/telemetry/application/change-message.js';
import {
  DispatchOutbox,
  OutboxReadiness,
} from '/app/apps/api/dist/modules/realtime/application/dispatch.js';
import { PostgresOutboxStore } from '/app/apps/api/dist/modules/realtime/adapters/postgres/outbox-store.js';
import { storedFrame } from '/app/apps/api/dist/modules/realtime/adapters/postgres/stored-frame.js';

const scenario = process.env.NEXO_PERSISTENCE_SCENARIO;
const prefix = `${scenario}:${randomUUID()}:`;
const runtime = new Pool(readDatabaseConfig(process.env).pool);
const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const db = drizzle(runtime);
const bytes = (value) => Buffer.from(encodeIdentity(value));
const accountKey = prefix + 'vehicle';
const eventRow = (id, vehicle = accountKey, observed = '2026-10-18T10:05:00Z') => {
  const instant = readObservedInstant(observed);
  assert.ok(instant);
  return {
    eventKey: encodeIdentity(id),
    vehicleKey: encodeIdentity(vehicle),
    observedAtOriginal: observed,
    observedEpochSecond: instant.epochSecond,
    observedFraction: instant.fraction,
    latitude: 4.6,
    longitude: -74.1,
    speedKph: 10,
    ignitionOn: true,
    payloadExtra: '{}',
  };
};
async function insertEvent(id = prefix + randomUUID(), vehicle = accountKey, observed) {
  const row = eventRow(id, vehicle, observed);
  const [stored] = await db
    .insert(telemetryEvents)
    .values(row)
    .returning({ eventPk: telemetryEvents.eventPk });
  assert.equal(typeof stored.eventPk, 'bigint');
  return { ...row, ...stored, id, vehicle };
}
async function rejected(promise, code) {
  let actual;
  try {
    await promise;
  } catch (error) {
    actual = error.code ?? error.cause?.code;
  }
  assert.equal(actual, code, 'La operación debe rechazarse por la restricción indicada.');
}
async function batch(total = 2, request = '{"events":[null,null]}') {
  const id = randomUUID();
  await db.insert(ingestionBatches).values({
    ingestionId: id,
    requestDocument: request,
    total,
    inputBytes: BigInt(Buffer.byteLength(request) * 2),
  });
  return id;
}
async function item(id, index, extra = {}) {
  await db
    .insert(ingestionItems)
    .values({ ingestionId: id, itemIndex: index, inputDocument: 'null', ...extra });
}
const scheduled = () => ({
  state: 'scheduled',
  generation: 1,
  opportunitiesReserved: 1,
  jobId: randomUUID(),
  notBefore: new Date(),
});
async function rawInsert(client, row) {
  return client.query(
    `INSERT INTO telemetry_events (event_key,vehicle_key,observed_at_original,observed_epoch_second,observed_fraction,latitude,longitude,speed_kph,ignition_on,payload_extra)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT ON CONSTRAINT telemetry_events_event_key_unique DO NOTHING RETURNING event_pk`,
    [
      Buffer.from(row.eventKey),
      Buffer.from(row.vehicleKey),
      row.observedAtOriginal,
      row.observedEpochSecond,
      row.observedFraction,
      row.latitude,
      row.longitude,
      row.speedKph,
      row.ignitionOn,
      row.payloadExtra,
    ],
  );
}

const cases = {
  async catalog() {
    const tables = await owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    assert.deepEqual(
      tables.rows.map((row) => row.tablename),
      [
        'alerts',
        'ingestion_batches',
        'ingestion_items',
        'outbox_messages',
        'replay_attempts',
        'replay_runs',
        'telemetry_events',
        'users',
        'vehicle_latest',
      ],
    );
    const exclusions = await owner.query(
      "SELECT c.conname,c.condeferrable,a.amname FROM pg_constraint c JOIN pg_class i ON i.oid=c.conindid JOIN pg_am a ON a.oid=i.relam WHERE c.contype='x' ORDER BY c.conname",
    );
    assert.deepEqual(exclusions.rows, [
      { conname: 'telemetry_events_event_key_unique', condeferrable: false, amname: 'hash' },
      { conname: 'vehicle_latest_vehicle_key_unique', condeferrable: false, amname: 'hash' },
    ]);
    const triggers = await owner.query(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY tgname",
    );
    assert.deepEqual(
      triggers.rows.map((row) => row.tgname),
      [
        'ingestion_batches_immutable_input',
        'ingestion_items_immutable_input',
        'nexo_replay_attempt_consistency',
        'nexo_replay_attempt_guard',
        'nexo_replay_run_consistency',
        'nexo_replay_run_guard',
        'outbox_messages_immutable_effect',
        'telemetry_events_immutable',
        'vehicle_latest_same_vehicle',
      ],
    );
    const collation = await owner.query(
      "SELECT c.collname FROM pg_attribute a JOIN pg_collation c ON c.oid=a.attcollation WHERE a.attrelid='telemetry_events'::regclass AND a.attname='observed_fraction'",
    );
    assert.equal(collation.rows[0].collname, 'C');
  },
  async unicode() {
    for (const suffix of [
      'A',
      'a',
      ' ',
      'é',
      'e\u0301',
      '\u0000',
      '\ud800',
      '\udc00',
      '\u{1f4a1}',
    ]) {
      const id = prefix + suffix;
      const vehicle = 'V:' + id;
      const row = await insertEvent(id, vehicle);
      await db.insert(vehicleLatest).values({ vehicleKey: row.vehicleKey, eventPk: row.eventPk });
      const read = await runtime.query(
        'SELECT event_key,vehicle_key FROM telemetry_events WHERE event_pk=$1',
        [row.eventPk],
      );
      assert.equal(decodeIdentity(read.rows[0].event_key) === id, true);
      assert.equal(decodeIdentity(read.rows[0].vehicle_key) === vehicle, true);
    }
  },
  async canonical() {
    for (const hex of ['', '000000', '00110000', 'ffffffff', '0000d8000000dc00']) {
      const bad = Buffer.from(hex, 'hex');
      const check = await runtime.query('SELECT nexo_identity_is_canonical($1) AS valid', [bad]);
      assert.equal(check.rows[0].valid, false);
      await rejected(
        db.insert(telemetryEvents).values({ ...eventRow(prefix + randomUUID()), eventKey: bad }),
        '23514',
      );
      await rejected(
        db.insert(telemetryEvents).values({ ...eventRow(prefix + randomUUID()), vehicleKey: bad }),
        '23514',
      );
    }
  },
  async long_identity() {
    const id = prefix + randomBytes(50000).toString('hex');
    const vehicle = 'V' + id;
    const row = await insertEvent(id, vehicle);
    const result = await rawInsert(runtime, row);
    assert.equal(result.rowCount, 0);
    const stored = await runtime.query(
      'SELECT event_key,vehicle_key FROM telemetry_events WHERE event_key=$1',
      [bytes(id)],
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(decodeIdentity(stored.rows[0].event_key) === id, true);
    assert.equal(decodeIdentity(stored.rows[0].vehicle_key) === vehicle, true);
  },
  async collision() {
    const firstId = 'A' + String.fromCodePoint(14831);
    const secondId = 'A' + String.fromCodePoint(188551);
    const hashes = await runtime.query(
      'SELECT hashbytea($1) AS a,hashbytea($2) AS b,$1::bytea <> $2::bytea AS different',
      [bytes(firstId), bytes(secondId)],
    );
    assert.deepEqual(hashes.rows[0], { a: -865594943, b: -865594943, different: true });
    const first = await insertEvent(firstId);
    const second = await insertEvent(secondId);
    assert.equal(first.eventPk !== second.eventPk, true);
    const rows = await runtime.query(
      'SELECT event_key FROM telemetry_events WHERE event_key=$1 OR event_key=$2',
      [bytes(firstId), bytes(secondId)],
    );
    assert.equal(rows.rows.length, 2);
  },
  async concurrency() {
    const first = await runtime.connect();
    const second = await runtime.connect();
    const row = eventRow(prefix + 'same');
    let pending;
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await rawInsert(first, row);
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = rawInsert(second, row).then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
      let waiting = false;
      for (let count = 0; count < 30; count += 1) {
        waiting = (
          await owner.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') AS waiting",
            [pid],
          )
        ).rows[0].waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'La segunda conexión debe competir antes del commit.');
      await first.query('COMMIT');
      const finished = await pending;
      if (finished.error) throw finished.error;
      assert.equal(finished.result.rowCount, 0);
      const reread = await second.query(
        'SELECT count(*) FROM telemetry_events WHERE event_key=$1',
        [Buffer.from(row.eventKey)],
      );
      assert.equal(reread.rows[0].count, '1');
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK');
      if (pending) await pending;
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  },
  async projection() {
    const first = await insertEvent(prefix + 'A', prefix + 'vehicleA');
    const second = await insertEvent(prefix + 'B', prefix + 'vehicleB');
    await db.insert(vehicleLatest).values({ vehicleKey: first.vehicleKey, eventPk: first.eventPk });
    await rejected(
      owner.query('UPDATE vehicle_latest SET event_pk=$1 WHERE vehicle_key=$2', [
        second.eventPk,
        Buffer.from(first.vehicleKey),
      ]),
      '23514',
    );
    await rejected(
      owner.query('UPDATE vehicle_latest SET vehicle_key=$1 WHERE vehicle_key=$2', [
        Buffer.from(second.vehicleKey),
        Buffer.from(first.vehicleKey),
      ]),
      '23514',
    );
    await rejected(
      db
        .insert(vehicleLatest)
        .values({ vehicleKey: encodeIdentity(prefix + 'missing'), eventPk: 9223372036854775807n }),
      '23503',
    );
    await rejected(
      owner.query('UPDATE telemetry_events SET speed_kph=11 WHERE event_pk=$1', [first.eventPk]),
      '23514',
    );
    const read = await runtime.query('SELECT event_pk FROM vehicle_latest WHERE vehicle_key=$1', [
      Buffer.from(first.vehicleKey),
    ]);
    assert.equal(read.rows[0].event_pk, first.eventPk.toString());
  },
  async time_order() {
    const specs = [
      [prefix + 'A', '1969-12-31T23:59:59.999999999999Z'],
      [prefix + 'B', '1970-01-01T00:00:00Z'],
      [prefix + 'Z', '2026-10-18T10:05:00.1234567891Z'],
      [prefix + '\ue000', '2026-10-18T10:05:00.1234567892Z'],
      [prefix + '\u{10000}', '2026-10-18T05:05:00.1234567892-05:00'],
    ];
    for (const [id, observed] of [...specs].reverse()) await insertEvent(id, accountKey, observed);
    const result = await runtime.query(
      'SELECT event_key,observed_epoch_second,observed_fraction FROM telemetry_events WHERE vehicle_key=$1 ORDER BY observed_epoch_second,observed_fraction,event_key',
      [bytes(accountKey)],
    );
    assert.deepEqual(
      result.rows.map((row) => decodeIdentity(row.event_key)),
      specs.map((pair) => pair[0]),
    );
    for (let index = 1; index < result.rows.length; index += 1) {
      const values = result.rows.slice(index - 1, index + 1).map((row) => ({
        epochSecond: BigInt(row.observed_epoch_second),
        fraction: row.observed_fraction,
      }));
      assert.equal(compareObservedInstant(values[0], values[1]) <= 0, true);
    }
    for (const fraction of ['10', '000', '.1', '1e0'])
      await rejected(
        db
          .insert(telemetryEvents)
          .values({ ...eventRow(prefix + randomUUID()), observedFraction: fraction }),
        '23514',
      );
  },
  async numeric_checks() {
    for (const overrides of [
      { latitude: NaN },
      { latitude: Infinity },
      { latitude: -90.01 },
      { longitude: -Infinity },
      { longitude: 180.01 },
      { speedKph: NaN },
      { speedKph: Infinity },
      { speedKph: -1 },
    ]) {
      await rejected(
        db.insert(telemetryEvents).values({ ...eventRow(prefix + randomUUID()), ...overrides }),
        '23514',
      );
    }
    await db
      .insert(telemetryEvents)
      .values({ ...eventRow(prefix + 'limits'), latitude: 90, longitude: -180, speedKph: 0 });
  },
  async original_input() {
    const source =
      ' {"events":[null, {"x":"\\ud800","zero":"\\u0000","large":9007199254740993}, 1e400]} ';
    const document = OriginalJson.parse(source);
    const values = document.property('events').elements();
    const id = await batch(values.length, document.raw);
    for (let index = 0; index < values.length; index += 1)
      await item(id, index, { inputDocument: values[index].raw });
    const parent = await runtime.query(
      'SELECT request_document::text FROM ingestion_batches WHERE ingestion_id=$1',
      [id],
    );
    assert.equal(parent.rows[0].request_document === source, true);
    const rows = await runtime.query(
      'SELECT input_document::text,state,resolved_event_pk,attempt_limit,policy_version FROM ingestion_items WHERE ingestion_id=$1 ORDER BY item_index',
      [id],
    );
    for (let index = 0; index < rows.rows.length; index += 1) {
      assert.equal(rows.rows[index].input_document === values[index].raw, true);
      assert.equal(rows.rows[index].state, 'waiting');
      assert.equal(rows.rows[index].resolved_event_pk, null);
      assert.equal(rows.rows[index].attempt_limit, 3);
      assert.equal(rows.rows[index].policy_version, 1);
    }
    assert.equal(OriginalJson.parse(rows.rows[2].input_document).numberValue, Infinity);
    let guard = false;
    try {
      await db
        .select({ input: ingestionItems.inputDocument })
        .from(ingestionItems)
        .where(eq(ingestionItems.ingestionId, id));
    } catch (error) {
      guard = error.message.includes('Los documentos JSON deben leerse');
    }
    assert.equal(guard, true, 'No permitir conversión JSON implícita del driver.');
  },
  async receipt_policy() {
    const id = await batch();
    await item(id, 0, scheduled());
    await item(id, 1);
    await rejected(
      owner.query(
        "UPDATE ingestion_items SET state='scheduled',generation=1,opportunities_reserved=1,job_id=$1,not_before=now() WHERE ingestion_id=$2 AND item_index=1",
        [randomUUID(), id],
      ),
      '23505',
    );
    await rejected(
      owner.query(
        'UPDATE ingestion_items SET attempt_limit=6 WHERE ingestion_id=$1 AND item_index=0',
        [id],
      ),
      '23514',
    );
    await rejected(
      owner.query(
        "UPDATE ingestion_items SET input_document='{}'::json WHERE ingestion_id=$1 AND item_index=0",
        [id],
      ),
      '23514',
    );
    await rejected(
      owner.query(
        "UPDATE ingestion_batches SET request_document='{}'::json,revision=revision+1 WHERE ingestion_id=$1",
        [id],
      ),
      '23514',
    );
    const event = await insertEvent();
    await owner.query(
      "UPDATE ingestion_items SET generation=2,opportunities_reserved=2,failure_code='WORKER_FAILED',last_failure_generation=1,last_failure_at=now(),not_before=now()+interval '1 second' WHERE ingestion_id=$1 AND item_index=0",
      [id],
    );
    await owner.query(
      "UPDATE ingestion_items SET state='classified',outcome='accepted',resolved_event_pk=$1,finalized_at=now() WHERE ingestion_id=$2 AND item_index=0",
      [event.eventPk, id],
    );
    await rejected(
      owner.query(
        "UPDATE ingestion_items SET outcome='rejected',resolved_event_pk=NULL,reason_code='INVALID_EVENT' WHERE ingestion_id=$1 AND item_index=0",
        [id],
      ),
      '23514',
    );
    await owner.query(
      'UPDATE ingestion_batches SET next_index=1,revision=revision+1 WHERE ingestion_id=$1',
      [id],
    );
  },
  async receipt_consistency() {
    const id = await batch(1);
    await item(id, 0, scheduled());
    for (const change of [
      "state='classified',outcome=NULL,reason_code='INVALID_EVENT',finalized_at=now()",
      "state='classified',outcome='accepted',finalized_at=now()",
      "state='classified',outcome='other',finalized_at=now()",
      "outcome='rejected',reason_code='INVALID_EVENT'",
      "state='phantom'",
    ]) {
      await rejected(
        owner.query(`UPDATE ingestion_items SET ${change} WHERE ingestion_id=$1`, [id]),
        '23514',
      );
    }
    await rejected(
      owner.query(
        "UPDATE ingestion_batches SET state='complete',revision=revision+1 WHERE ingestion_id=$1",
        [id],
      ),
      '23514',
    );
  },
  async technical_failure() {
    const id = await batch();
    await item(id, 0, scheduled());
    await item(id, 1);
    await owner.query(
      "UPDATE ingestion_items SET state='failed',generation=3,opportunities_reserved=3,failure_code='RETRY_EXHAUSTED',last_failure_generation=3,last_failure_at=now(),finalized_at=now() WHERE ingestion_id=$1 AND item_index=0",
      [id],
    );
    await owner.query(
      "UPDATE ingestion_items SET state='blocked',failure_code='PREVIOUS_ITEM_FAILED',finalized_at=now() WHERE ingestion_id=$1 AND item_index=1",
      [id],
    );
    await owner.query(
      "UPDATE ingestion_batches SET state='failed',failed_index=0,failure_code='RETRY_EXHAUSTED',revision=revision+1 WHERE ingestion_id=$1",
      [id],
    );
    const counts = await runtime.query(
      "SELECT count(*) FILTER(WHERE state IN ('failed','blocked')) AS technical,count(*) FILTER(WHERE outcome='rejected') AS rejected FROM ingestion_items WHERE ingestion_id=$1",
      [id],
    );
    assert.deepEqual(counts.rows[0], { technical: '2', rejected: '0' });
    await rejected(
      owner.query('UPDATE ingestion_batches SET revision=revision+1 WHERE ingestion_id=$1', [id]),
      '23514',
    );
  },
  async outbox() {
    const event = await insertEvent();
    const id = randomUUID();
    const payload = JSON.stringify({ eventId: event.id, type: 'telemetry.accepted' });
    const row = {
      messageId: id,
      eventPk: event.eventPk,
      type: 'telemetry.accepted',
      payload,
      frameBytes: Buffer.byteLength(`id:${id}\nevent:telemetry.accepted\ndata:${payload}\n\n`),
    };
    await db.insert(outboxMessages).values(row);
    await rejected(db.insert(outboxMessages).values({ ...row, messageId: randomUUID() }), '23505');
    await rejected(
      owner.query("UPDATE outbox_messages SET payload='{}'::json WHERE message_id=$1", [id]),
      '23514',
    );
    await runtime.query(
      "UPDATE outbox_messages SET attempts=1,last_error_code='TRANSPORT_ERROR' WHERE message_id=$1",
      [id],
    );
    await runtime.query(
      'UPDATE outbox_messages SET attempts=2,last_error_code=NULL,published_at=now() WHERE message_id=$1',
      [id],
    );
    await rejected(
      owner.query('UPDATE outbox_messages SET published_at=NULL WHERE message_id=$1', [id]),
      '23514',
    );
    const read = await runtime.query(
      'SELECT payload::text,attempts FROM outbox_messages WHERE message_id=$1',
      [id],
    );
    assert.equal(read.rows[0].payload === payload, true);
    assert.equal(read.rows[0].attempts, 2);
  },
  async privileges() {
    const result = await owner.query(
      "SELECT has_table_privilege('nexo_app','telemetry_events','INSERT') AS insert_event,has_table_privilege('nexo_app','telemetry_events','UPDATE') AS update_event,has_table_privilege('nexo_app','telemetry_events','DELETE') AS delete_event,has_column_privilege('nexo_app','vehicle_latest','event_pk','UPDATE') AS update_latest,has_column_privilege('nexo_app','vehicle_latest','vehicle_key','UPDATE') AS update_identity,has_column_privilege('nexo_app','outbox_messages','payload','UPDATE') AS update_payload",
    );
    assert.deepEqual(result.rows[0], {
      insert_event: true,
      update_event: false,
      delete_event: false,
      update_latest: true,
      update_identity: false,
      update_payload: false,
    });
    await rejected(runtime.query('UPDATE telemetry_events SET speed_kph=11'), '42501');
    await rejected(runtime.query('DELETE FROM telemetry_events'), '42501');
    const temporary = await owner.query(
      "SELECT has_database_privilege('nexo_app','nexo','TEMPORARY') AS allowed",
    );
    assert.equal(temporary.rows[0].allowed, false);
    await rejected(runtime.query('CREATE TEMP TABLE forbidden_temp(id int)'), '42501');
  },
  async upgrade() {
    const config = readDatabaseConfig(process.env, true);
    const temporary = await mkdtemp(join(tmpdir(), 'nexo-legacy-migration-'));
    try {
      // Solo el PostgreSQL sintético de este escenario. La API no ofrece reset.
      await owner.query(
        'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA drizzle CASCADE',
      );
      const journal = JSON.parse(
        await readFile(join(config.migrationsFolder, 'meta/_journal.json'), 'utf8'),
      );
      await mkdir(join(temporary, 'meta'));
      await copyFile(
        join(config.migrationsFolder, '0000_demo_user.sql'),
        join(temporary, '0000_demo_user.sql'),
      );
      await writeFile(
        join(temporary, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
      );
      const legacy = drizzle(owner);
      await migrate(legacy, { migrationsFolder: temporary });
      await legacy
        .insert(users)
        .values({ username: 'demo', passwordHash: await hash('demo', passwordHashOptions) });
      const before = (await owner.query('SELECT row_to_json(u)::text AS snapshot FROM users u'))
        .rows[0].snapshot;
      assert.equal(
        (await owner.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,
        '1',
      );
      await prepareDatabase(config);
      const after = (await owner.query('SELECT row_to_json(u)::text AS snapshot FROM users u'))
        .rows[0].snapshot;
      assert.equal(before === after, true, 'Migrar E0 conserva exactamente la cuenta y su hash.');
      assert.equal(
        (await owner.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,
        String(journal.entries.length),
      );
      await prepareDatabase(config);
      const repeated = (await owner.query('SELECT row_to_json(u)::text AS snapshot FROM users u'))
        .rows[0].snapshot;
      assert.equal(after === repeated, true);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
  async restart_seed() {
    const id = prefix + '\u0000\ud800';
    const data = {
      ...eventRow(id),
      speedKph: 81,
      payloadExtra: '{"inert":1e400,"escaped":"\\ud800"}',
    };
    const [event] = await db
      .insert(telemetryEvents)
      .values(data)
      .returning({ eventPk: telemetryEvents.eventPk });
    await db.insert(vehicleLatest).values({ vehicleKey: data.vehicleKey, eventPk: event.eventPk });
    await db.insert(alerts).values({ eventPk: event.eventPk, type: 'OVERSPEED' });
    const known = JSON.stringify({
      eventId: id,
      vehicleId: accountKey,
      observedAt: data.observedAtOriginal,
      latitude: 4.6,
      longitude: -74.1,
      speedKph: 81,
      ignitionOn: true,
    });
    const input = known.slice(0, -1) + ',"inert":1e400,"escaped":"\\ud800"}';
    const request = ` {"events":[${input}]} `;
    const receipt = randomUUID();
    const stamp = new Date();
    await db.insert(ingestionBatches).values({
      ingestionId: receipt,
      requestDocument: request,
      total: 1,
      inputBytes: BigInt(Buffer.byteLength(request) + Buffer.byteLength(input)),
    });
    await item(receipt, 0, {
      inputDocument: input,
      state: 'classified',
      outcome: 'accepted',
      resolvedEventPk: event.eventPk,
      generation: 1,
      opportunitiesReserved: 1,
      jobId: randomUUID(),
      notBefore: stamp,
      finalizedAt: stamp,
    });
    await runtime.query(
      "UPDATE ingestion_batches SET state='complete',next_index=1,revision=1 WHERE ingestion_id=$1",
      [receipt],
    );
    const validated = validateEvent(OriginalJson.parse(input));
    assert.equal(validated.valid, true);
    for (const type of ['telemetry.accepted', 'vehicle.updated', 'alert.created']) {
      const messageId = randomUUID();
      const message = changeMessage(type, validated.event, messageId);
      const payload = JSON.stringify(message);
      await db.insert(outboxMessages).values({
        messageId,
        eventPk: event.eventPk,
        type,
        payload,
        frameBytes: Buffer.byteLength(changeFrame(message)),
      });
    }
    // Comparar las seis tablas completas una vez terminado el trabajo de
    // publicación. Recrear contenedores debe conservar también esas marcas;
    // no se excluye metadata ni se desactiva el dispatcher del servidor.
    const dispatcher = new DispatchOutbox(
      new PostgresOutboxStore(runtime),
      storedFrame,
      () => {},
      new OutboxReadiness(),
    );
    while (await dispatcher.group(new globalThis.AbortController().signal)) {
      /* drenar los grupos */
    }
    assert.equal(
      (
        await runtime.query(
          'SELECT count(*)::int AS n FROM outbox_messages WHERE published_at IS NULL',
        )
      ).rows[0].n,
      0,
    );
    assert.equal(dispatcher.readiness.healthy, true);
  },
};

try {
  assert.equal(Object.hasOwn(cases, scenario), true, 'Seleccionar un escenario conocido.');
  await cases[scenario]();
  console.log('persistence-case-ok');
} finally {
  await runtime.end();
  await owner.end();
}
