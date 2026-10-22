import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { hash } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { prepareDatabase } from '/app/apps/api/dist/platform/database/prepare.js';
import { passwordHashOptions } from '/app/apps/api/dist/platform/database/password-policy.js';
import { prepareQueue } from '/app/apps/api/dist/platform/queue/prepare.js';
import { queueOptions, ingestionQueue } from '/app/apps/api/dist/platform/queue/policy.js';
import { DatabaseSlots } from '/app/apps/api/dist/platform/database/slots.js';
import { AdmissionStore } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/admission-store.js';
import { IngestionCapacityError } from '/app/apps/api/dist/modules/ingestion/application/ingest.js';
import { ReceiptReader } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/receipt-reader.js';
import { ProcessItem } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/process-item.js';
import { RecoverItem } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/recover-item.js';
import { readBatch } from '/app/apps/api/dist/modules/ingestion/domain/batch.js';
import { ReconcileIngestion } from '/app/apps/api/dist/modules/ingestion/application/reconcile.js';

const config = readDatabaseConfig(process.env);
const pool = new Pool(config.pool);
const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const boss = new PgBoss(queueOptions(config));
const queueErrors = [];
boss.on('error', () => queueErrors.push('QUEUE_ERROR'));
const slots = new DatabaseSlots(16, 0);
const admission = new AdmissionStore(pool, pool, boss, slots);
const reader = new ReceiptReader(pool, slots);
const processor = new ProcessItem(pool, boss);
const recovery = new RecoverItem(pool, boss);
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function prepareHistoricalE1(configOwner, directory) {
  // Fixture del esquema publicado E1, anterior a las tablas de replay. El
  // preparador actual exige el esquema actual y se prueba después del upgrade.
  await migrate(drizzle(owner), { migrationsFolder: directory });
  await owner.query("INSERT INTO users(username,password_hash) VALUES('demo',$1)", [
    await hash('demo', passwordHashOptions),
  ]);
  const client = await owner.connect();
  try {
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query('REVOKE TEMPORARY ON DATABASE nexo FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA public, drizzle TO nexo_app');
    await client.query('GRANT SELECT ON public.users, drizzle.__drizzle_migrations TO nexo_app');
    await client.query(`GRANT SELECT, INSERT ON public.telemetry_events, public.vehicle_latest,
      public.alerts, public.ingestion_batches, public.ingestion_items, public.outbox_messages TO nexo_app`);
    await client.query('GRANT UPDATE (event_pk) ON public.vehicle_latest TO nexo_app');
    await client.query(
      'GRANT UPDATE ON public.ingestion_batches, public.ingestion_items TO nexo_app',
    );
    await client.query(`GRANT UPDATE (available_at, published_at, attempts, last_error_code)
      ON public.outbox_messages TO nexo_app`);
    await client.query(`GRANT USAGE, SELECT ON SEQUENCE public.telemetry_events_event_pk_seq,
      public.vehicle_latest_vehicle_pk_seq TO nexo_app`);
    await prepareQueue(configOwner, client);
  } finally {
    client.release();
  }
}
async function admit(events = [event()]) {
  const id = randomUUID();
  await admission.admit(id, readBatch(JSON.stringify({ events })));
  return id;
}
async function resetData() {
  await owner.query(
    'TRUNCATE ingestion_items,ingestion_batches,outbox_messages,alerts,vehicle_latest,telemetry_events RESTART IDENTITY CASCADE',
  );
  await owner.query('DELETE FROM pgboss.job WHERE name=$1', [ingestionQueue]);
}
async function current(id) {
  const r = (
    await pool.query(
      `SELECT i.*,i.not_before::text AS exact_not_before FROM ingestion_items i
 JOIN ingestion_batches b USING(ingestion_id) WHERE i.ingestion_id=$1 AND i.item_index=b.next_index`,
      [id],
    )
  ).rows[0];
  return r
    ? {
        row: r,
        id: r.job_id,
        data: { ingestionId: id, index: r.item_index, generation: r.generation },
      }
    : undefined;
}
async function remove(jobId) {
  await owner.query('DELETE FROM pgboss.job WHERE name=$1 AND id=$2', [ingestionQueue, jobId]);
}
async function snapshot() {
  const result = {};
  for (const table of [
    'telemetry_events',
    'vehicle_latest',
    'alerts',
    'outbox_messages',
    'ingestion_batches',
    'ingestion_items',
  ])
    result[table] = (
      await pool.query(
        `SELECT coalesce(json_agg(row_to_json(t)::text ORDER BY row_to_json(t)::text),'[]'::json)::text AS data FROM ${table} t`,
      )
    ).rows[0].data;
  result.jobs = (
    await pool.query(
      'SELECT coalesce(array_agg(id::text ORDER BY id),ARRAY[]::text[]) AS ids FROM pgboss.job WHERE name=$1',
      [ingestionQueue],
    )
  ).rows[0].ids;
  return result;
}
async function checkScheduled(id) {
  const row = (
    await owner.query(
      `SELECT i.not_before=j.start_after AS same_instant,j.retry_limit,
 extract(epoch FROM i.not_before-i.last_failure_at) AS delay
 FROM ingestion_items i JOIN ingestion_batches b USING(ingestion_id)
 JOIN pgboss.job j ON j.id=i.job_id AND j.name=$2
 WHERE i.ingestion_id=$1 AND i.item_index=b.next_index`,
      [id, ingestionQueue],
    )
  ).rows[0];
  assert.equal(row.same_instant, true, 'Scheduler y recibo conservan el mismo microsegundo.');
  assert.equal(row.retry_limit, 0);
  return Number(row.delay);
}
async function executeNext() {
  const [job] = await boss.fetch(ingestionQueue, { batchSize: 1 });
  assert.ok(job);
  assert.equal(await processor.execute(job.id, job.data, signal), 'classified');
  await boss.complete(ingestionQueue, job.id);
  return job;
}
function lostCommitPool() {
  const pids = [];
  let commits = 0;
  return {
    pids,
    get commits() {
      return commits;
    },
    pool: {
      connect: async () => {
        const client = await pool.connect();
        pids.push(client.processID);
        return new Proxy(client, {
          get(target, property) {
            if (property === 'query')
              return async (...args) => {
                const result = await target.query(...args);
                if (args[0] === 'COMMIT') {
                  commits++;
                  throw Error('COMMIT_REPLY_LOST');
                }
                return result;
              };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    },
  };
}
const cases = {
  async capacity() {
    const minimal = '{"events":[null]}';
    const rejectNew = async () => {
      const id = randomUUID();
      const before = (await pool.query('SELECT count(*) FROM ingestion_batches')).rows[0].count;
      await assert.rejects(admission.admit(id, readBatch(minimal)), IngestionCapacityError);
      assert.equal(await reader.find(id), undefined);
      assert.equal(
        (await pool.query('SELECT count(*) FROM ingestion_batches')).rows[0].count,
        before,
      );
    };
    const full = readBatch(JSON.stringify({ events: Array(1000).fill(null) }));
    const first = randomUUID();
    for (let n = 0; n < 20; n++) await admission.admit(n === 0 ? first : randomUUID(), full);
    assert.equal(
      (await pool.query('SELECT sum(total-next_index) AS n FROM ingestion_batches')).rows[0].n,
      '20000',
    );
    await rejectNew();
    assert.equal(await admission.admit(first, full), 'existing');

    await resetData();
    const bodyLimit = 2 * 1024 * 1024;
    const activeId = randomUUID();
    for (let n = 0; n < 32; n++)
      await admission.admit(
        n === 0 ? activeId : randomUUID(),
        readBatch(minimal.padEnd(bodyLimit - (n === 31 ? 128 : 0))),
      );
    const active = (
      await pool.query(`SELECT sum(input_bytes)::text AS bytes,
      bool_and(input_bytes=octet_length(request_document::text)+4) AS exact FROM ingestion_batches`)
    ).rows[0];
    assert.deepEqual(active, { bytes: String(64 * 1024 * 1024), exact: true });
    await rejectNew();
    assert.equal(await admission.admit(activeId, readBatch(minimal)), 'existing');

    // Fixtures completos de capacidad; no acreditan procesar 200 000 posiciones.
    // Sus documentos, fragmentos y bytes lógicos siguen siendo consistentes.
    await resetData();
    let retainedId;
    for (let page = 0; page < 20; page++) {
      const ids = Array.from({ length: 10 }, () => randomUUID());
      retainedId ??= ids[0];
      await owner.query(
        `WITH batches AS (
        INSERT INTO ingestion_batches(ingestion_id,request_document,total,input_bytes,state,next_index,revision)
        SELECT id,$2::json,1000,$3::bigint,'complete',1000,1000 FROM unnest($1::uuid[]) AS id
        RETURNING ingestion_id
      ) INSERT INTO ingestion_items(ingestion_id,item_index,input_document,state,outcome,reason_code,
        generation,opportunities_reserved,job_id,not_before,finalized_at)
        SELECT ingestion_id,n,'null'::json,'classified','rejected','INVALID_EVENT',1,1,gen_random_uuid(),now(),now()
        FROM batches CROSS JOIN generate_series(0,999) AS n`,
        [ids, full.document.raw, full.inputBytes.toString()],
      );
    }
    assert.equal(
      (await pool.query('SELECT sum(total) AS n FROM ingestion_batches')).rows[0].n,
      '200000',
    );
    await rejectNew();
    assert.equal(await admission.admit(retainedId, full), 'existing');
    assert.equal((await reader.find(retainedId)).complete, true);

    await resetData();
    let byteId;
    for (let page = 0; page < 32; page++) {
      const ids = Array.from({ length: 8 }, () => randomUUID());
      byteId ??= ids[0];
      await owner.query(
        `WITH batches AS (
        INSERT INTO ingestion_batches(ingestion_id,request_document,total,input_bytes,state,next_index,revision)
        SELECT id,rpad($2::text,$3::int-CASE WHEN $4::boolean AND ordinal=8 THEN 1024 ELSE 0 END,' ')::json,
        1,$3::bigint+4-CASE WHEN $4::boolean AND ordinal=8 THEN 1024 ELSE 0 END,'complete',1,1
        FROM unnest($1::uuid[]) WITH ORDINALITY AS input(id,ordinal) RETURNING ingestion_id
      ) INSERT INTO ingestion_items(ingestion_id,item_index,input_document,state,outcome,reason_code,
        generation,opportunities_reserved,job_id,not_before,finalized_at)
        SELECT ingestion_id,0,'null'::json,'classified','rejected','INVALID_EVENT',1,1,gen_random_uuid(),now(),now()
        FROM batches`,
        [ids, minimal, bodyLimit, page === 31],
      );
    }
    const retained = (
      await pool.query(`SELECT sum(input_bytes)::text AS bytes,
      bool_and(input_bytes=octet_length(request_document::text)+4) AS exact,
      count(*) FILTER(WHERE state='active')::int AS active FROM ingestion_batches`)
    ).rows[0];
    assert.deepEqual(retained, { bytes: String(512 * 1024 * 1024), exact: true, active: 0 });
    await rejectNew();
    assert.equal(await admission.admit(byteId, readBatch(minimal)), 'existing');
    assert.equal((await reader.find(byteId)).complete, true);
  },
  async migration() {
    const configOwner = readDatabaseConfig(process.env, true);
    const directory = mkdtempSync(join(tmpdir(), 'nexo-e1-prefix-'));
    mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(
      readFileSync(join(configOwner.migrationsFolder, 'meta/_journal.json'), 'utf8'),
    );
    const prefix = { ...journal, entries: journal.entries.slice(0, 2) };
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(prefix));
    for (const entry of prefix.entries)
      writeFileSync(
        join(directory, entry.tag + '.sql'),
        readFileSync(join(configOwner.migrationsFolder, entry.tag + '.sql')),
      );
    try {
      await owner.query(
        'DROP SCHEMA public CASCADE;CREATE SCHEMA public;DROP SCHEMA IF EXISTS drizzle CASCADE',
      );
      await prepareHistoricalE1(configOwner, directory);
      const id = await admit([event(), event()]);
      await executeNext();
      const work = await current(id);
      const before = await snapshot();
      const user = (
        await owner.query("SELECT row_to_json(u)::text AS data FROM users u WHERE username='demo'")
      ).rows[0].data;
      const early = `UPDATE ingestion_items SET state='failed',failure_code=$2,last_failure_generation=generation,last_failure_at=clock_timestamp(),finalized_at=clock_timestamp() WHERE ingestion_id=$1 AND item_index=1`;
      await assert.rejects(owner.query(early, [id, 'INGESTION_INVARIANT']), { code: '23514' });
      await prepareDatabase(configOwner);
      await prepareDatabase(configOwner);
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        user ===
          (
            await owner.query(
              "SELECT row_to_json(u)::text AS data FROM users u WHERE username='demo'",
            )
          ).rows[0].data,
        true,
        'Cuenta/hash conservados sin publicar su valor.',
      );
      assert.equal(
        (await owner.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count,
        String(journal.entries.length),
      );
      await assert.rejects(owner.query(early, [id, 'JOB_FAILED']), { code: '23514' });
      await assert.rejects(
        owner.query(
          'UPDATE ingestion_items SET generation=4,opportunities_reserved=4 WHERE ingestion_id=$1 AND item_index=1',
          [id],
        ),
        { code: '23514' },
      );
      assert.equal(await recovery.recover(work.id, work.data, 'INGESTION_INVARIANT'), 'failed');
      assert.equal((await reader.find(id)).accepted, 1);
      const stored = (
        await pool.query(
          'SELECT opportunities_reserved FROM ingestion_items WHERE ingestion_id=$1 AND item_index=1',
          [id],
        )
      ).rows[0];
      assert.equal(stored.opportunities_reserved, 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  async missing() {
    const id = await admit();
    const work = await current(id);
    await remove(work.id);
    const second = new RecoverItem(pool, boss);
    const results = await Promise.all([
      recovery.recover(work.id, work.data),
      second.recover(work.id, work.data),
    ]);
    assert.equal(results.filter((r) => r === 'scheduled').length, 1);
    assert.equal(
      results.every((r) => ['scheduled', 'skipped', 'obsolete'].includes(r)),
      true,
    );
    const next = await current(id);
    assert.equal(next.row.generation, 2);
    assert.equal(next.row.opportunities_reserved, 2);
    const delay = await checkScheduled(id);
    assert.equal(delay >= 1.999 && delay <= 2.51, true);
    assert.equal((await boss.findJobs(ingestionQueue, { limit: 10 })).length, 1);
    const committed = await snapshot();
    assert.equal(await recovery.recover(work.id, work.data), 'obsolete');
    assert.deepEqual(await snapshot(), committed);
    assert.deepEqual(await boss.fetch(ingestionQueue, { batchSize: 1 }), []);
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !(
        await pool.query(
          'SELECT clock_timestamp()>=not_before AS due FROM ingestion_items WHERE ingestion_id=$1',
          [id],
        )
      ).rows[0].due
    )
      await pause(20);
    await executeNext();
    const receipt = await reader.find(id);
    assert.equal(receipt.complete, true);
    assert.equal(receipt.accepted, 1);
    assert.equal(receipt.revision, 2);
    assert.equal(await recovery.recover(next.id, next.data, 'PROCESSING_UNCONFIRMED'), 'obsolete');
  },
  async backoff() {
    const id = await admit([null]);
    let work = await current(id);
    await owner.query(
      "UPDATE ingestion_items SET not_before=clock_timestamp()+interval '1 hour' WHERE ingestion_id=$1",
      [id],
    );
    const original = (await current(id)).row.exact_not_before;
    for (const generation of [2, 3]) {
      await remove(work.id);
      assert.equal(await recovery.recover(work.id, work.data), 'scheduled');
      const next = await current(id);
      assert.equal(next.row.generation, generation);
      assert.equal(next.row.exact_not_before, original);
      await checkScheduled(id);
      const before = await snapshot();
      assert.equal(await recovery.recover(work.id, work.data), 'obsolete');
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await boss.fetch(ingestionQueue, { batchSize: 1 }), []);
      work = next;
    }
    await remove(work.id);
    assert.equal(await recovery.recover(work.id, work.data), 'failed');
    const receipt = await reader.find(id);
    assert.deepEqual([receipt.accepted, receipt.duplicates, receipt.rejected], [0, 0, 0]);
    assert.deepEqual(receipt.failedIndexes, [0]);
    assert.deepEqual(receipt.pendingIndexes, []);
    assert.equal(receipt.complete, false);
    const before = await snapshot();
    assert.equal(await recovery.recover(work.id, work.data), 'obsolete');
    assert.deepEqual(await snapshot(), before);
  },
  async exhaustion() {
    const events = [event({ speedKph: 80 }), event({ latitude: 91 }), event(), event(), event()];
    const id = await admit(events);
    await executeNext();
    await executeNext();
    const prefix = (
      await pool.query(
        'SELECT row_to_json(i)::text AS data FROM ingestion_items i WHERE ingestion_id=$1 AND item_index<2 ORDER BY item_index',
        [id],
      )
    ).rows;
    for (let generation = 1; generation <= 3; generation++) {
      const work = await current(id);
      await remove(work.id);
      assert.equal(
        await recovery.recover(work.id, work.data),
        generation === 3 ? 'failed' : 'scheduled',
      );
    }
    const receipt = await reader.find(id);
    assert.deepEqual([receipt.accepted, receipt.duplicates, receipt.rejected], [1, 0, 1]);
    assert.deepEqual(receipt.failedIndexes, [2, 3, 4]);
    assert.deepEqual(receipt.pendingIndexes, []);
    assert.equal(receipt.complete, false);
    assert.deepEqual(receipt.failures, [
      { index: 2, code: 'JOB_MISSING' },
      { index: 3, code: 'BLOCKED_BY_PREVIOUS_FAILURE' },
      { index: 4, code: 'BLOCKED_BY_PREVIOUS_FAILURE' },
    ]);
    assert.deepEqual(
      (
        await pool.query(
          'SELECT row_to_json(i)::text AS data FROM ingestion_items i WHERE ingestion_id=$1 AND item_index<2 ORDER BY item_index',
          [id],
        )
      ).rows,
      prefix,
    );
    const suffix = (
      await pool.query(
        'SELECT generation,opportunities_reserved,last_failure_generation,last_failure_at FROM ingestion_items WHERE ingestion_id=$1 AND item_index>2',
        [id],
      )
    ).rows;
    assert.equal(
      suffix.every(
        (r) =>
          r.generation === 0 &&
          r.opportunities_reserved === 0 &&
          r.last_failure_generation === null &&
          r.last_failure_at === null,
      ),
      true,
    );
    const other = await admit();
    await executeNext();
    assert.equal((await reader.find(other)).complete, true);
    assert.deepEqual((await reader.find(id)).failedIndexes, [2, 3, 4]);
  },
  async terminal() {
    for (const kind of ['cancelled', 'completed', 'INGESTION_INVARIANT', 'SCHEMA_INCOMPATIBLE']) {
      const id = await admit();
      const work = await current(id);
      let code;
      if (kind === 'cancelled') {
        await boss.cancel(ingestionQueue, work.id);
        code = 'QUEUE_CANCELLED';
      } else if (kind === 'completed') {
        const [job] = await boss.fetch(ingestionQueue, { batchSize: 1 });
        assert.equal(job.id, work.id);
        await boss.complete(ingestionQueue, work.id);
        code = 'QUEUE_PROTOCOL_VIOLATION';
      } else code = kind;
      assert.equal(
        await recovery.recover(work.id, work.data, kind === code ? code : undefined),
        'failed',
      );
      const row = (
        await pool.query(
          'SELECT generation,opportunities_reserved,failure_code FROM ingestion_items WHERE ingestion_id=$1',
          [id],
        )
      ).rows[0];
      assert.deepEqual(row, { generation: 1, opportunities_reserved: 1, failure_code: code });
      assert.equal((await reader.find(id)).rejected, 0);
      await remove(work.id);
    }
    const id = randomUUID(),
      jobId = randomUUID(),
      batch = readBatch('{"events":[null]}');
    await owner.query(
      'INSERT INTO ingestion_batches(ingestion_id,request_document,total,input_bytes) VALUES($1,$2::json,1,$3)',
      [id, batch.document.raw, batch.inputBytes.toString()],
    );
    await owner.query(
      "INSERT INTO ingestion_items(ingestion_id,item_index,input_document,state,generation,opportunities_reserved,job_id,not_before,policy_version) VALUES($1,0,'null'::json,'scheduled',1,1,$2,clock_timestamp(),2)",
      [id, jobId],
    );
    assert.equal(
      await recovery.recover(jobId, { ingestionId: id, index: 0, generation: 1 }),
      'failed',
    );
    assert.deepEqual((await reader.find(id)).failures, [{ index: 0, code: 'SCHEMA_INCOMPATIBLE' }]);
  },
  async uncertainty() {
    let id = await admit([event(), event()]);
    let work = await current(id);
    await remove(work.id);
    const before = await snapshot();
    const failing = {
      send: async (...args) => {
        await boss.send(...args);
        throw Error('AFTER_SEND_EXPECTED');
      },
    };
    await assert.rejects(
      new RecoverItem(pool, failing).recover(work.id, work.data, 'JOB_MISSING'),
      { message: 'AFTER_SEND_EXPECTED' },
    );
    assert.deepEqual(await snapshot(), before);
    const lost = lostCommitPool();
    await assert.rejects(
      new RecoverItem(lost.pool, boss).recover(work.id, work.data, 'JOB_MISSING'),
      { message: 'COMMIT_REPLY_LOST' },
    );
    assert.equal(lost.commits, 1);
    assert.equal((await current(id)).row.generation, 2);
    const recovered = await snapshot();
    assert.equal(await recovery.recover(work.id, work.data), 'obsolete');
    assert.deepEqual(await snapshot(), recovered);
    // Otro recibo permite comprobar COMMIT de dominio perdido y ACK posterior fallido.
    await owner.query('DELETE FROM pgboss.job WHERE name=$1', [ingestionQueue]);
    id = await admit([event({ speedKph: 80 }), event({ speedKph: 80 })]);
    work = await current(id);
    const [job] = await boss.fetch(ingestionQueue, { batchSize: 1 });
    assert.equal(job.id, work.id);
    const lostResult = lostCommitPool();
    await assert.rejects(new ProcessItem(lostResult.pool, boss).execute(job.id, job.data, signal), {
      message: 'COMMIT_REPLY_LOST',
    });
    const committed = await snapshot();
    const receipt = await reader.find(id);
    assert.equal(receipt.accepted, 1);
    assert.equal(receipt.revision, 1);
    assert.equal(await recovery.recover(job.id, job.data, 'PROCESSING_UNCONFIRMED'), 'obsolete');
    await boss.fail(ingestionQueue, job.id, { code: 'ACK_UNCONFIRMED' });
    assert.equal(await recovery.recover(job.id, job.data), 'obsolete');
    assert.deepEqual(await snapshot(), committed);
    assert.equal(await processor.execute(job.id, job.data, signal), 'obsolete');
    await executeNext();
    assert.equal((await reader.find(id)).accepted, 2);
    for (const pid of [...lost.pids, ...lostResult.pids]) {
      let remaining = 1;
      for (let n = 0; n < 50 && remaining; n++) {
        remaining = Number(
          (await owner.query('SELECT count(*) FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]
            .count,
        );
        if (remaining) await pause(10);
      }
      assert.equal(remaining, 0, 'El cliente de respuesta incierta no regresa al pool.');
    }
  },
  async unavailable() {
    const id = await admit();
    const work = await current(id);
    const before = await snapshot();
    const unreadable = {
      findJobs: async () => {
        throw Error('JOB_LOOKUP_UNAVAILABLE');
      },
    };
    await assert.rejects(new RecoverItem(pool, unreadable).recover(work.id, work.data), {
      message: 'JOB_LOOKUP_UNAVAILABLE',
    });
    assert.deepEqual(await snapshot(), before);
    const down = new Pool({ ...config.pool, port: 5433, connectionTimeoutMillis: 200 });
    try {
      await assert.rejects(new RecoverItem(down, boss).recover(work.id, work.data));
      assert.deepEqual(await snapshot(), before);
    } finally {
      await down.end();
    }
    const lock = await pool.connect();
    await lock.query('BEGIN');
    try {
      await lock.query(
        'SELECT ingestion_id FROM ingestion_batches WHERE ingestion_id=$1 FOR UPDATE',
        [id],
      );
      const start = Date.now();
      assert.equal(await recovery.recover(work.id, work.data), 'skipped');
      assert.equal(Date.now() - start < 1000, true);
      const other = await admit();
      const next = await current(other);
      await remove(next.id);
      assert.equal(await recovery.recover(next.id, next.data), 'scheduled');
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    assert.equal((await current(id)).row.generation, 1);
  },
  async fairness() {
    for (let n = 0; n < 32; n++) await admit([null]);
    await owner.query('DELETE FROM pgboss.job WHERE name=$1', [ingestionQueue]);
    const first = await recovery.page(undefined);
    assert.equal(first.length, 20);
    const ids = first.map((c) => c.cursor.ingestionId);
    const lock = await pool.connect();
    await lock.query('BEGIN');
    const reconcile = new ReconcileIngestion(recovery);
    try {
      await lock.query(
        'SELECT ingestion_id FROM ingestion_batches WHERE ingestion_id=ANY($1::uuid[]) FOR UPDATE',
        [ids],
      );
      assert.deepEqual(await reconcile.runPass(signal), {
        inspected: 32,
        changed: 12,
        skipped: 20,
        unverified: 0,
      });
      const counts = await pool.query(
        'SELECT generation,count(*)::int AS n FROM ingestion_items GROUP BY generation ORDER BY generation',
      );
      assert.deepEqual(counts.rows, [
        { generation: 1, n: 20 },
        { generation: 2, n: 12 },
      ]);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    assert.deepEqual(await reconcile.runPass(signal), {
      inspected: 32,
      changed: 20,
      skipped: 0,
      unverified: 0,
    });
    assert.equal(
      (
        await pool.query(
          'SELECT count(*) FROM ingestion_items WHERE generation=2 AND opportunities_reserved=2',
        )
      ).rows[0].count,
      '32',
    );
  },
};
try {
  await boss.start();
  // Solo el stack sintético de esta suite; cada fallo usa un escenario separado.
  await resetData();
  assert.equal(Object.hasOwn(cases, process.env.NEXO_RECOVERY_CASE), true);
  await cases[process.env.NEXO_RECOVERY_CASE]();
  assert.equal(queueErrors.length, 0);
  console.log('recovery-case-ok');
} finally {
  await boss.stop({ graceful: false });
  await pool.end();
  await owner.end();
}
