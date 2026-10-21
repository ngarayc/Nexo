import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { queueOptions, ingestionQueue } from '/app/apps/api/dist/platform/queue/policy.js';
import { DatabaseSlots } from '/app/apps/api/dist/platform/database/slots.js';
import { AdmissionStore } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/admission-store.js';
import { ReceiptReader } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/receipt-reader.js';
import { ProcessItem } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/process-item.js';
import { readBatch } from '/app/apps/api/dist/modules/ingestion/domain/batch.js';

const config = readDatabaseConfig(process.env);
const pool = new Pool(config.pool);
const boss = new PgBoss(queueOptions(config));
const queueErrors = [];
boss.on('error', () => queueErrors.push('QUEUE_ERROR'));
const slots = new DatabaseSlots(16, 0);
const store = new AdmissionStore(pool, pool, boss, slots);
const reader = new ReceiptReader(pool, slots);
const processItem = new ProcessItem(pool, boss);
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
async function admit(events) {
  const id = randomUUID();
  await store.admit(id, readBatch(JSON.stringify({ events })));
  return id;
}
async function item(id, index = 0) {
  return (
    await pool.query(
      'SELECT job_id,generation FROM ingestion_items WHERE ingestion_id=$1 AND item_index=$2',
      [id, index],
    )
  ).rows[0];
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
  ]) {
    result[table] = (
      await pool.query(
        `SELECT coalesce(json_agg(row_to_json(t)::text ORDER BY row_to_json(t)::text),'[]'::json)::text AS value FROM ${table} t`,
      )
    ).rows[0].value;
  }
  result.jobs = (
    await pool.query('SELECT array_agg(id::text ORDER BY id)::text AS value FROM pgboss.job')
  ).rows[0].value;
  return result;
}
const cases = {
  async chain() {
    const vehicleId = randomUUID();
    const inputs = [
      event({ vehicleId, speedKph: 80 }),
      event({ vehicleId, latitude: 91 }),
      event({ vehicleId, observedAt: '2025-12-31T23:00:00Z', speedKph: 95 }),
    ];
    const id = await admit(inputs);
    for (let index = 0; index < inputs.length; index++) {
      const job = (await boss.fetch(ingestionQueue, { batchSize: 1 }))[0];
      assert.equal(job.data.ingestionId, id);
      assert.equal(job.data.index, index);
      assert.equal(await processItem.execute(job.id, job.data, signal), 'classified');
      const receipt = await reader.find(id);
      assert.equal(receipt.revision, index + 1);
      assert.equal(receipt.results.length, index + 1);
      assert.equal(receipt.complete, index === 2);
      const committed = await snapshot();
      assert.equal(await processItem.execute(job.id, job.data, signal), 'obsolete');
      assert.deepEqual(await snapshot(), committed);
      await boss.complete(ingestionQueue, job.id);
      assert.equal(
        (await boss.findJobs(ingestionQueue, { id: job.id, limit: 1 }))[0].state,
        'completed',
      );
    }
    const receipt = await reader.find(id);
    assert.deepEqual([receipt.accepted, receipt.duplicates, receipt.rejected], [2, 0, 1]);
    assert.deepEqual(receipt.errors, [
      { index: 1, eventId: inputs[1].eventId, reason: 'INVALID_LATITUDE' },
    ]);
    assert.deepEqual(receipt.pendingIndexes, []);
    assert.equal((await pool.query('SELECT count(*) FROM outbox_messages')).rows[0].count, '4');
  },
  async fences() {
    const id = await admit([event()]);
    const saved = await item(id);
    const data = { ingestionId: id, index: 0, generation: 1 };
    const before = await snapshot();
    for (const [jobId, work] of [
      [randomUUID(), data],
      [saved.job_id, { ...data, generation: 2 }],
      [saved.job_id, { ...data, index: 1 }],
      [saved.job_id, { ...data, ingestionId: randomUUID() }],
    ])
      assert.equal(await processItem.execute(jobId, work, signal), 'obsolete');
    assert.deepEqual(await snapshot(), before);
    await pool.query(
      "UPDATE ingestion_items SET not_before=clock_timestamp()+interval '1 hour' WHERE ingestion_id=$1",
      [id],
    );
    const deferred = await snapshot();
    assert.equal(await processItem.execute(saved.job_id, data, signal), 'obsolete');
    assert.deepEqual(await snapshot(), deferred);
    // notBefore es monotónico: otro recibo prueba cancelación/ejecución sin
    // retroceder el instante reservado de la posición diferida.
    const readyId = await admit([event()]);
    const ready = await item(readyId);
    const readyData = { ingestionId: readyId, index: 0, generation: 1 };
    const aborted = new globalThis.AbortController();
    aborted.abort();
    await assert.rejects(processItem.execute(ready.job_id, readyData, aborted.signal));
    assert.equal((await reader.find(readyId)).revision, 0);
    assert.equal(await processItem.execute(ready.job_id, readyData, signal), 'classified');
  },
  async rollback() {
    const id = await admit([event(), event()]);
    const saved = await item(id);
    const before = await snapshot();
    const failing = {
      send: async (...args) => {
        await boss.send(...args);
        throw Error('AFTER_CONTINUATION_EXPECTED');
      },
    };
    await assert.rejects(
      new ProcessItem(pool, failing).execute(
        saved.job_id,
        { ingestionId: id, index: 0, generation: 1 },
        signal,
      ),
      { message: 'AFTER_CONTINUATION_EXPECTED' },
    );
    assert.deepEqual(await snapshot(), before);
    assert.equal((await reader.find(id)).revision, 0);
    assert.equal((await item(id, 1)).generation, 0);
  },
};
try {
  await boss.start();
  assert.equal(Object.hasOwn(cases, process.env.NEXO_PROCESSING_CASE), true);
  await cases[process.env.NEXO_PROCESSING_CASE]();
  assert.equal(queueErrors.length, 0, 'La biblioteca no debe emitir fallos técnicos.');
  console.log('processing-case-ok');
} finally {
  await boss.stop({ graceful: false });
  await pool.end();
}
