// Estados de integración controlados. No son evidencia del emisor HTTP ni de dos clientes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { DatabaseSlots } from '/app/apps/api/dist/platform/database/slots.js';
import { queueOptions, ingestionQueue } from '/app/apps/api/dist/platform/queue/policy.js';
import { FileOfficialSources } from '/app/apps/api/dist/modules/demo/adapters/files/official-sources.js';
import { loadReplaySoftwareFingerprint } from '/app/apps/api/dist/modules/demo/adapters/files/replay-software.js';
import {
  LoadOfficialFixture,
  OfficialSourcesUnavailable,
} from '/app/apps/api/dist/modules/demo/application/official-fixture.js';
import { VerifyOfficialReplay } from '/app/apps/api/dist/modules/demo/application/verify-official.js';
import {
  PostgresReplayEvidence,
  ReplayEvidenceUnavailable,
} from '/app/apps/api/dist/modules/demo/adapters/postgres/replay-evidence.js';
import { PostgresReplayJournal } from '/app/apps/api/dist/modules/demo/adapters/postgres/journal.js';
import { AdmissionStore } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/admission-store.js';
import { ProcessItem } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/process-item.js';
import { ReceiptReader } from '/app/apps/api/dist/modules/ingestion/adapters/postgres/receipt-reader.js';
import { readBatch } from '/app/apps/api/dist/modules/ingestion/domain/batch.js';

const config = readDatabaseConfig(process.env),
  write = new Pool(config.pool),
  read = new Pool({ ...config.pool, max: 4 });
const owner = new Pool(readDatabaseConfig(process.env, true).pool),
  slots = new DatabaseSlots(16, 0);
const boss = new PgBoss({
  ...queueOptions(config),
  supervise: false,
  schedule: false,
  registerInstance: false,
  useListenNotify: false,
});
const errors = [];
boss.on('error', () => errors.push('QUEUE_ERROR'));
const fixture = await new LoadOfficialFixture(new FileOfficialSources()).load();
const migrationHash = readMigrationFiles({ migrationsFolder: config.migrationsFolder }).at(-1).hash;
const environment = {
  instanceId: randomUUID(),
  ready: true,
  softwareFingerprint: await loadReplaySoftwareFingerprint(),
  configurationFingerprint: 'b'.repeat(64),
};
const reader = (pool = read, env = () => ({ ...environment }), hash = migrationHash) =>
  new PostgresReplayEvidence(pool, slots, boss, fixture, hash, env);
const verifier = () => new VerifyOfficialReplay(fixture, reader());
const journal = new PostgresReplayJournal(write, read, new DatabaseSlots(1, 15), slots);
const admission = new AdmissionStore(write, read, boss, slots),
  processor = new ProcessItem(write, boss),
  receipts = new ReceiptReader(read, slots);
const findCheck = (report, key) => report.checks.find((check) => check.key === key);
async function receive(body, ingestionId = randomUUID()) {
  await admission.admit(ingestionId, readBatch(body));
  const jobs = await boss.fetch(ingestionQueue, { batchSize: 1, includeMetadata: true });
  assert.equal(jobs.length, 1);
  assert.equal(
    await processor.execute(jobs[0].id, jobs[0].data, AbortSignal.timeout(10000)),
    'classified',
  );
  await boss.complete(ingestionQueue, jobs[0].id);
  return receipts.find(ingestionId);
}
async function complete(first = null, bodyFor = (row) => row.body) {
  const runId = randomUUID();
  let snapshot = await journal.create({
    runId,
    scenarioId: first?.run.runId ?? runId,
    previousRunId: first?.run.runId ?? null,
    instanceId: environment.instanceId,
    fixtureSha256: fixture.fixtureSha256,
    stage: first ? 'second' : 'first',
    intervalMs: 750,
  });
  snapshot = await journal.transition(runId, snapshot.run.revision, { state: 'running' });
  for (const row of fixture.rows) {
    const ingestionId = randomUUID();
    snapshot = await journal.beginAttempt(runId, snapshot.run.revision, ingestionId, row.eventId);
    const receipt = await receive(bodyFor(row), ingestionId),
      outcome = first ? row.secondOutcome : row.firstOutcome;
    assert.equal(receipt.complete, true);
    assert.equal(receipt.results[0].outcome, outcome);
    snapshot = await journal.resolveAttempt(
      runId,
      snapshot.run.revision,
      { state: 'classified', outcome, reasonCode: row.reason },
      { state: 'running' },
    );
  }
  // Solo el estado de publicación para el comparador. No afirma SSE emitido ni renderizado.
  await owner.query(
    'UPDATE outbox_messages SET published_at=clock_timestamp() WHERE published_at IS NULL',
  );
  return snapshot;
}
const clear = async () => {
  await boss.deleteAllJobs(ingestionQueue);
  await owner.query(
    'TRUNCATE replay_attempts,replay_runs,ingestion_items,ingestion_batches,outbox_messages,alerts,vehicle_latest,telemetry_events RESTART IDENTITY CASCADE',
  );
};
const cases = {
  async sources() {
    assert.equal(fixture.rows.length, 24);
    assert.match(environment.softwareFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(await loadReplaySoftwareFingerprint(), environment.softwareFingerprint);
    const files = new FileOfficialSources();
    await assert.rejects(
      new LoadOfficialFixture({
        read: async (name) => (name === 'events.jsonl' ? Buffer.from('altered') : files.read(name)),
      }).load(),
      OfficialSourcesUnavailable,
    );
  },
  async preparation() {
    assert.equal((await verifier().prepare()).result, 'conformant');
    const id = await boss.send(ingestionQueue, { synthetic: 'fresh-inventory' });
    let facts = await reader().read();
    assert.deepEqual(facts.jobs, { complete: true, queued: 1, active: 0 });
    assert.equal((await verifier().prepare()).result, 'inconclusive');
    const [job] = await boss.fetch(ingestionQueue, { batchSize: 1 });
    assert.equal(job.id, id);
    facts = await reader().read();
    assert.deepEqual(facts.jobs, { complete: true, queued: 0, active: 1 });
    assert.equal((await verifier().prepare()).result, 'inconclusive');
    await boss.complete(ingestionQueue, id);
    assert.equal((await verifier().prepare()).result, 'conformant');
  },
  async official() {
    let first = await complete();
    const report = await verifier().evaluate(first.run.runId);
    assert.equal(report.result, 'conformant');
    assert.equal(
      report.checks.every((check) => check.state === 'matches'),
      true,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(report)) < 65536);
    first = await journal.verify(
      first.run.runId,
      first.run.revision,
      report.result,
      JSON.stringify(report),
    );
    assert.equal((await verifier().inspect(first.run.runId)).currentState, 'same');
    assert.equal((await verifier().prepareSecond(first.run.runId)).result, 'conformant');
    const second = await complete(first),
      secondReport = await verifier().evaluate(second.run.runId);
    assert.equal(secondReport.result, 'conformant');
    assert.deepEqual(findCheck(secondReport, 'classifications').observed, {
      accepted: 0,
      duplicates: 22,
      rejected: 2,
    });
    assert.equal(findCheck(secondReport, 'message-count').observed, 43);
    await journal.verify(
      second.run.runId,
      second.run.revision,
      secondReport.result,
      JSON.stringify(secondReport),
    );
    const historical = await verifier().inspect(first.run.runId);
    assert.deepEqual(historical.report, report);
    assert.equal(historical.currentState, 'changed');
    assert.equal(report.externalEvidence.twoRenderedClients, 'not_assessed');
  },
  async identities() {
    // Sembrar la identidad incorrecta desde el ingreso, sin desactivar la
    // inmutabilidad SQL ni alterar las fuentes originales.
    const first = await complete(null, (row) =>
      row.eventId === 'E-003-01' ? row.body.replace('"E-003-01"', '"wrong-id"') : row.body,
    );
    const report = await verifier().evaluate(first.run.runId);
    assert.equal(report.result, 'non_conformant');
    assert.equal(findCheck(report, 'domain-counts').state, 'matches');
    assert.equal(findCheck(report, 'accepted-identities').state, 'differs');
  },
  async foreign_duplicate() {
    await foreign(fixture.rows[0].body, 'duplicate');
  },
  async foreign_rejected() {
    await foreign(fixture.rows[21].body, 'rejected');
  },
  async coherence() {
    let inserted = false;
    const tapped = {
      connect: async () => {
        const client = await read.connect();
        return new Proxy(client, {
          get(target, key) {
            if (key === 'query')
              return async (...args) => {
                const value = await target.query(...args),
                  text = typeof args[0] === 'string' ? args[0] : args[0].text;
                if (!inserted && text.includes('FROM replay_attempts) AS attempts')) {
                  inserted = true;
                  await admission.admit(randomUUID(), readBatch(fixture.rows[0].body));
                }
                return value;
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    const before = await reader(tapped).read();
    assert.equal(inserted, true);
    assert.equal(before.counts.receipts, 0);
    assert.deepEqual(before.receiptIds, []);
    assert.deepEqual(before.jobs, { complete: true, queued: 0, active: 0 });
    const after = await reader().read();
    assert.equal(after.counts.receipts, 1);
    assert.equal(after.receiptIds.length, 1);
    assert.equal(after.jobs.queued, 1);
  },
  async incomplete() {
    await boss.insert(
      ingestionQueue,
      Array.from({ length: 1001 }, () => ({ data: { synthetic: 'inventory-limit' } })),
    );
    const report = await verifier().prepare();
    assert.equal(report.result, 'inconclusive');
    assert.equal(findCheck(report, 'queue-inventory').state, 'unavailable');
  },
  async unavailable() {
    const wrongSchema = await reader(read, () => ({ ...environment }), 'c'.repeat(64)).read();
    assert.equal(wrongSchema.environment.ready, false);
    let calls = 0;
    await assert.rejects(
      reader(read, () => ({
        ...environment,
        instanceId: ++calls === 1 ? environment.instanceId : randomUUID(),
      })).read(),
      ReplayEvidenceUnavailable,
    );
    const failing = {
      connect: async () => {
        throw new Error('synthetic-private-marker');
      },
    };
    const report = await new VerifyOfficialReplay(fixture, reader(failing)).prepare();
    assert.equal(report.result, 'inconclusive');
    assert.equal(report.observedAt, null);
    assert.equal(findCheck(report, 'coherent-read').observed, null);
    assert.equal(JSON.stringify(report).includes('synthetic-private-marker'), false);
    await assert.rejects(reader().read('../../untrusted'), ReplayEvidenceUnavailable);
  },
};
async function foreign(body, outcome) {
  const first = await complete(),
    before = (await reader().read(first.run.runId)).counts;
  const receipt = await receive(body);
  assert.equal(receipt.results[0].outcome, outcome);
  const after = (await reader().read(first.run.runId)).counts;
  for (const key of ['events', 'vehicles', 'alerts', 'messages'])
    assert.equal(after[key], before[key]);
  const report = await verifier().evaluate(first.run.runId);
  assert.equal(report.result, 'non_conformant');
  assert.equal(findCheck(report, 'no-foreign-receipts').state, 'differs');
}
try {
  await boss.start();
  await clear();
  const selected = cases[process.env.NEXO_VERIFICATION_CASE];
  assert.equal(typeof selected, 'function');
  await selected();
  assert.deepEqual(errors, []);
  console.log('replay-verification-case-ok');
} finally {
  await boss.stop({ graceful: false });
  await Promise.all([write.end(), read.end(), owner.end()]);
}
