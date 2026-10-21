import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { ingestionQueue, queueOptions } from '/app/apps/api/dist/platform/queue/policy.js';
import { ingestionBatches, ingestionItems } from '/app/apps/api/dist/platform/database/schema.js';
import {
  AdmissionStore,
  IngestionIdConflict,
  IngestionCapacityError,
} from '/app/apps/api/dist/modules/ingestion/adapters/postgres/admission-store.js';
import { ReceiptReader } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/receipt-reader.js';
import { readBatch } from '/app/apps/api/dist/modules/ingestion/domain/batch.js';
import { DatabaseSlots } from '/app/apps/api/dist/platform/database/slots.js';
import { prepareDatabase } from '/app/apps/api/dist/platform/database/prepare.js';

const config = readDatabaseConfig(process.env);
const pool = new Pool(config.pool);
const db = drizzle(pool);
const boss = new PgBoss(queueOptions(config));
const querySlots = new DatabaseSlots(16, 0);
const store = new AdmissionStore(pool, pool, boss, querySlots);
const reader = new ReceiptReader(pool, querySlots);
const errors = [];
boss.on('error', () => errors.push('QUEUE_ERROR'));
const cases = {
  async policy() {
    const version = await pool.query('SELECT version FROM pgboss.version');
    assert.equal(version.rows[0].version, 46);
    const queue = await boss.getQueue(ingestionQueue);
    assert.equal(queue.name, ingestionQueue);
    assert.equal(queue.policy, 'standard');
    assert.equal(queue.retryLimit, 0);
    assert.equal(queue.expireInSeconds, 30);
    assert.equal(queue.retentionSeconds, 604800);
    assert.equal(queue.deleteAfterSeconds, 86400);
    assert.equal(queue.notify, true);
    assert.equal(queue.partition, false);
  },
  async runtime() {
    const access = await pool.query(
      "SELECT current_user AS username,has_schema_privilege('nexo_app','pgboss','CREATE') AS ddl",
    );
    assert.deepEqual(access.rows[0], { username: 'nexo_app', ddl: false });
    const id = randomUUID();
    assert.equal(await boss.send(ingestionQueue, { proof: id }, { id, retryLimit: 0 }), id);
    const jobs = await boss.fetch(ingestionQueue, { batchSize: 1, includeMetadata: true });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, id);
    assert.equal(jobs[0].retryLimit, 0);
    await boss.complete(ingestionQueue, id);
    const [stored] = await boss.findJobs(ingestionQueue, { id, limit: 1 });
    assert.equal(stored.state, 'completed');
    await boss.supervise(ingestionQueue);
  },
  async transaction() {
    for (const shouldCommit of [false, true]) {
      const ingestionId = randomUUID();
      const jobId = randomUUID();
      const requestDocument = '{"events":[null]}';
      const run = db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL transaction_timeout = '10s'`);
        await tx.insert(ingestionBatches).values({
          ingestionId,
          requestDocument,
          total: 1,
          inputBytes: BigInt(Buffer.byteLength(requestDocument) + 4),
        });
        await tx.insert(ingestionItems).values({
          ingestionId,
          itemIndex: 0,
          inputDocument: 'null',
          state: 'scheduled',
          generation: 1,
          opportunitiesReserved: 1,
          jobId,
          notBefore: sql`now()`,
        });
        const result = await boss.send(
          ingestionQueue,
          { ingestionId, index: 0, generation: 1 },
          { id: jobId, retryLimit: 0, db: fromDrizzle(tx, sql) },
        );
        assert.equal(result, jobId);
        if (!shouldCommit) throw new Error('ROLLBACK_EXPECTED');
      });
      if (shouldCommit) await run;
      else await assert.rejects(run, { message: 'ROLLBACK_EXPECTED' });
      const receipt = await pool.query(
        'SELECT count(*) FROM ingestion_batches WHERE ingestion_id=$1',
        [ingestionId],
      );
      const items = await pool.query('SELECT count(*) FROM ingestion_items WHERE ingestion_id=$1', [
        ingestionId,
      ]);
      const jobs = await boss.findJobs(ingestionQueue, { id: jobId, limit: 1 });
      assert.equal(receipt.rows[0].count, shouldCommit ? '1' : '0');
      assert.equal(items.rows[0].count, shouldCommit ? '1' : '0');
      assert.equal(jobs.length, shouldCommit ? 1 : 0);
    }
  },
  async admission() {
    const ingestionId = randomUUID();
    const batch = readBatch(
      ' {"meta":1e400,"events":[null,1e400,{"eventId":"ID\\u0000\\ud800","big":9007199254740993}]} ',
    );
    assert.equal(await store.admit(ingestionId, batch), 'created');
    const receipt = await reader.find(ingestionId);
    assert.deepEqual(receipt, {
      ingestionId,
      revision: 0,
      complete: false,
      total: 3,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      results: [],
      errors: [],
      pendingIndexes: [0, 1, 2],
      failedIndexes: [],
      failures: [],
    });
    assert.equal(await reader.find(randomUUID()), undefined);
    const original = await pool.query(
      'SELECT request_document::text,input_bytes::text FROM ingestion_batches WHERE ingestion_id=$1',
      [ingestionId],
    );
    assert.equal(original.rows[0].request_document === batch.document.raw, true);
    assert.equal(original.rows[0].input_bytes, batch.inputBytes.toString());
    const items = await pool.query(
      'SELECT input_document::text,state,generation,job_id FROM ingestion_items WHERE ingestion_id=$1 ORDER BY item_index',
      [ingestionId],
    );
    for (const [index, item] of items.rows.entries()) {
      assert.equal(item.input_document === batch.items[index].raw, true);
      assert.equal(item.state, index === 0 ? 'scheduled' : 'waiting');
      assert.equal(item.generation, index === 0 ? 1 : 0);
      assert.equal(item.job_id === null, index !== 0);
    }
  },
  async idempotency() {
    const ingestionId = randomUUID();
    const batch = readBatch('{"meta":1e400,"events":[null,{"n":9007199254740993}]}');
    const other = new AdmissionStore(pool, pool, boss, querySlots);
    const results = await Promise.all([
      store.admit(ingestionId, batch),
      other.admit(ingestionId, batch),
    ]);
    assert.deepEqual(results.sort(), ['created', 'existing']);
    assert.equal(
      await store.admit(
        ingestionId,
        readBatch('{ "events":[null,{"n":9007199254740993}],"meta":10e399 }'),
      ),
      'existing',
    );
    await assert.rejects(
      store.admit(ingestionId, readBatch('{"meta":1e401,"events":[null,{"n":9007199254740993}]}')),
      IngestionIdConflict,
    );
    await assert.rejects(
      store.admit(ingestionId, readBatch('{"meta":1e400,"events":[null,{"n":9007199254740992}]}')),
      IngestionIdConflict,
    );
    const jobs = await pool.query(
      'SELECT job_id FROM ingestion_items WHERE ingestion_id=$1 AND item_index=0',
      [ingestionId],
    );
    assert.equal(jobs.rows.length, 1);
    assert.equal(
      (await boss.findJobs(ingestionQueue, { id: jobs.rows[0].job_id, limit: 1 })).length,
      1,
    );
  },
  async admission_rollback() {
    const ingestionId = randomUUID();
    let jobId;
    const failing = {
      send: async (...args) => {
        jobId = args[2].id;
        await boss.send(...args);
        throw new Error('AFTER_SEND_EXPECTED');
      },
    };
    const failingStore = new AdmissionStore(pool, pool, failing, querySlots);
    await assert.rejects(failingStore.admit(ingestionId, readBatch('{"events":[null]}')), {
      message: 'AFTER_SEND_EXPECTED',
    });
    assert.equal(await reader.find(ingestionId), undefined);
    assert.equal(
      (
        await pool.query('SELECT count(*) FROM ingestion_items WHERE ingestion_id=$1', [
          ingestionId,
        ])
      ).rows[0].count,
      '0',
    );
    assert.equal((await boss.findJobs(ingestionQueue, { id: jobId, limit: 1 })).length, 0);
  },
  async preparation() {
    const ownerConfig = readDatabaseConfig(process.env, true);
    const owner = new Pool(ownerConfig.pool);
    const before = (await pool.query('SELECT count(*) FROM pgboss.job')).rows[0].count;
    try {
      await prepareDatabase(ownerConfig);
      assert.equal((await pool.query('SELECT count(*) FROM pgboss.job')).rows[0].count, before);
      await owner.query("UPDATE pgboss.queue SET policy='short' WHERE name=$1", [ingestionQueue]);
      await assert.rejects(prepareDatabase(ownerConfig), {
        message: 'La cola existente tiene una política incompatible; no se reemplaza.',
      });
    } finally {
      await owner.query("UPDATE pgboss.queue SET policy='standard' WHERE name=$1", [
        ingestionQueue,
      ]);
      await owner.end();
    }
    await prepareDatabase(ownerConfig);
    assert.equal((await pool.query('SELECT count(*) FROM pgboss.job')).rows[0].count, before);
  },
  async quota() {
    const count = Number(
      (await pool.query("SELECT count(*) FROM ingestion_batches WHERE state='active'")).rows[0]
        .count,
    );
    for (let index = count; index < 63; index += 1) {
      const ingestionId = randomUUID();
      const batch = readBatch('{"events":[null]}');
      await db.insert(ingestionBatches).values({
        ingestionId,
        requestDocument: batch.document.raw,
        total: 1,
        inputBytes: batch.inputBytes,
      });
      await db.insert(ingestionItems).values({ ingestionId, itemIndex: 0, inputDocument: 'null' });
    }
    const ids = [randomUUID(), randomUUID()];
    const batch = readBatch('{"events":[null]}');
    const other = new AdmissionStore(pool, pool, boss, querySlots);
    const results = await Promise.allSettled([
      store.admit(ids[0], batch),
      other.admit(ids[1], batch),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled' && result.value === 'created')
        .length,
      1,
    );
    assert.equal(
      results.filter(
        (result) => result.status === 'rejected' && result.reason instanceof IngestionCapacityError,
      ).length,
      1,
    );
    const winner = results[0].status === 'fulfilled' ? ids[0] : ids[1];
    assert.equal(await store.admit(winner, batch), 'existing');
    assert.equal(
      (await pool.query("SELECT count(*) FROM ingestion_batches WHERE state='active'")).rows[0]
        .count,
      '64',
    );
  },
};
try {
  await boss.start();
  assert.equal(Object.hasOwn(cases, process.env.NEXO_QUEUE_CASE), true);
  await cases[process.env.NEXO_QUEUE_CASE]();
  assert.equal(errors.length, 0, 'La biblioteca no debe emitir fallos técnicos.');
  console.log('queue-case-ok');
} finally {
  await boss.stop({ graceful: false });
  await pool.end();
}
