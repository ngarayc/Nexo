// Actor real + PostgreSQL/ingesta HTTP reales. Intercepta respuestas de COMMIT
// exclusivamente en el cliente de pruebas; el producto no contiene estos hooks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { DatabaseSlots } from '/app/apps/api/dist/platform/database/slots.js';
import { queueOptions } from '/app/apps/api/dist/platform/queue/policy.js';
import { FileOfficialSources } from '/app/apps/api/dist/modules/demo/adapters/files/official-sources.js';
import { loadReplaySoftwareFingerprint } from '/app/apps/api/dist/modules/demo/adapters/files/replay-software.js';
import { LoadOfficialFixture } from '/app/apps/api/dist/modules/demo/application/official-fixture.js';
import { VerifyOfficialReplay } from '/app/apps/api/dist/modules/demo/application/verify-official.js';
import { ReplayCoordinator } from '/app/apps/api/dist/modules/demo/application/replay-coordinator.js';
import {
  ReplayAdmissionUnknown,
  ReplayAdmissionNotApplied,
} from '/app/apps/api/dist/modules/demo/application/admit-command.js';
import { PostgresReplayEvidence } from '/app/apps/api/dist/modules/demo/adapters/postgres/replay-evidence.js';
import { PostgresReplayJournal } from '/app/apps/api/dist/modules/demo/adapters/postgres/journal.js';
import { LoopbackReplayProducer } from '/app/apps/api/dist/modules/demo/adapters/http/replay-producer.js';

const config = readDatabaseConfig(process.env);
const write = new Pool({ ...config.pool, max: 2 }),
  read = new Pool({ ...config.pool, max: 2 });
const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const boss = new PgBoss({
  ...queueOptions(config),
  supervise: false,
  schedule: false,
  registerInstance: false,
  useListenNotify: false,
});
boss.on('error', () => {});
let stage = 'setup',
  coordinator;
const losses = []; // true confirma en PostgreSQL antes de perder la respuesta.
const lossyPool = {
  async connect() {
    const client = await write.connect();
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query')
          return async (...args) => {
            if (args[0] === 'COMMIT') {
              if (losses.length) {
                if (losses.shift()) await target.query('COMMIT');
                throw new Error('synthetic-commit-response-lost');
              }
            }
            return target.query(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
};
const fixture = await new LoadOfficialFixture(new FileOfficialSources()).load();
const instanceId = randomUUID();
const slots = new DatabaseSlots(16, 0);
const journal = new PostgresReplayJournal(lossyPool, read, new DatabaseSlots(1, 15), slots);
const environment = {
  instanceId,
  ready: true,
  softwareFingerprint: await loadReplaySoftwareFingerprint(),
  configurationFingerprint: 'c'.repeat(64),
};
const verifier = new VerifyOfficialReplay(
  fixture,
  new PostgresReplayEvidence(
    read,
    slots,
    boss,
    fixture,
    readMigrationFiles({ migrationsFolder: config.migrationsFolder }).at(-1).hash,
    () => environment,
  ),
);
const actual = new LoopbackReplayProducer(3000, process.env.INGEST_API_KEY);
let sends = 0,
  beforeDelivery = () => {};
const producer = {
  async send(...args) {
    sends++;
    const result = await actual.send(...args);
    beforeDelivery();
    return result;
  },
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error('synthetic-fault-condition-timeout');
}
async function order(action) {
  const view = await coordinator.view();
  return {
    commandId: randomUUID(),
    instanceId,
    expectedControlVersion: view.controlVersion,
    runId: view.run?.runId ?? null,
    action,
    ...(action === 'start' ? { intervalMs: 5000 } : {}),
  };
}
async function snapshot() {
  return journal.current();
}
async function effectCount() {
  return (
    await owner.query(
      'SELECT (SELECT count(*)::int FROM telemetry_events) AS events,(SELECT count(*)::int FROM ingestion_batches) AS receipts',
    )
  ).rows[0];
}
const cases = {
  async command_unknown() {
    stage = 'uncertain-admission';
    const command = await order('start');
    losses.push(true, true); // Creación y respuesta de la barrera desconocidas.
    await assert.rejects(coordinator.command(command), ReplayAdmissionUnknown);
    assert.equal(sends, 0);
    assert.equal(coordinator.admissions.receipts.get(command.commandId), undefined);
    const stored = await snapshot();
    assert.equal(stored.run.intention.commandId, command.commandId);
    assert.equal(stored.run.state, 'preparing');
    stage = 'confirmed-admission';
    await coordinator.view();
    await waitFor(() => sends === 1);
    assert.equal(coordinator.admissions.receipts.get(command.commandId).admission.accepted, true);
    await coordinator.command(await order('pause'));
    await waitFor(async () => (await snapshot()).run.state === 'paused');
    assert.equal(sends, 1);
  },
  async command_rollback() {
    stage = 'not-applied-admission';
    const command = await order('start');
    losses.push(false);
    await assert.rejects(coordinator.command(command), ReplayAdmissionNotApplied);
    assert.equal(await snapshot(), undefined);
    assert.equal(sends, 0);
    assert.equal(coordinator.admissions.receipts.get(command.commandId), undefined);
    assert.deepEqual(await effectCount(), { events: 0, receipts: 0 });
  },
  async result_applied() {
    await resultLoss(true);
  },
  async result_rollback() {
    await resultLoss(false);
  },
  async response_lost() {
    stage = 'http-response-lost-after-processing';
    const loss = new LoopbackReplayProducer(3000, process.env.INGEST_API_KEY, async (...args) => {
      const response = await fetch(...args);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      throw new Error('synthetic-response-lost');
    });
    coordinator.close();
    coordinator = new ReplayCoordinator(
      journal,
      fixture,
      {
        async send(...args) {
          sends++;
          return loss.send(...args);
        },
      },
      verifier,
      new DatabaseSlots(1, 15),
      instanceId,
    );
    await coordinator.initialize();
    await coordinator.command(await order('start'));
    await waitFor(async () => (await snapshot())?.run.state === 'error');
    const closed = await snapshot();
    assert.equal(closed.run.verification, 'inconclusive');
    assert.equal(closed.progress.uncertain, 1);
    assert.equal(closed.progress.rejected, 0);
    assert.deepEqual(await effectCount(), { events: 1, receipts: 1 });
    await delay(250);
    assert.equal(sends, 1);
  },
  async finish_applied() {
    stage = 'pause-before-finish-loss';
    await coordinator.command(await order('start'));
    await waitFor(async () => (await snapshot())?.progress.classified === 1);
    await coordinator.command(await order('pause'));
    await waitFor(async () => (await snapshot()).run.state === 'paused');
    const close = journal.closeScenario.bind(journal);
    let closes = 0;
    journal.closeScenario = async (...args) => {
      closes++;
      losses.push(true);
      return close(...args);
    };
    const finish = await order('finishVerification');
    stage = 'scenario-commit-lost';
    await coordinator.command(finish);
    await waitFor(async () => Boolean((await snapshot()).run.scenarioClosedAt));
    const document = (await snapshot()).run.scenarioDocument;
    await waitFor(
      () => coordinator.admissions.receipts.get(finish.commandId).resolution === 'pending',
    );
    stage = 'scenario-close-confirmed';
    const view = await coordinator.view();
    assert.equal(view.scenario.verification, 'inconclusive');
    assert.equal(coordinator.admissions.receipts.get(finish.commandId).resolution, 'completed');
    assert.equal((await snapshot()).run.scenarioDocument, document);
    assert.equal(closes, 1);
    assert.equal(sends, 1);
  },
};
async function resultLoss(committed) {
  stage = 'result-commit-lost';
  let resultSettled = false;
  const resolveAttempt = journal.resolveAttempt.bind(journal);
  journal.resolveAttempt = async (...args) => {
    try {
      return await resolveAttempt(...args);
    } finally {
      resultSettled = true;
    }
  };
  beforeDelivery = () => {
    losses.push(committed);
    beforeDelivery = () => {};
  };
  await coordinator.command(await order('start'));
  await waitFor(() => resultSettled);
  const before = await snapshot();
  assert.equal(before.progress.classified, committed ? 1 : 0);
  assert.equal(before.progress.inFlight, committed ? 0 : 1);
  stage = 'result-recovery-without-resend';
  const recovered = await coordinator.view();
  assert.equal(recovered.run.state, 'error');
  assert.equal(recovered.run.verification, 'inconclusive');
  assert.equal(recovered.run.progress.accepted, committed ? 1 : 0);
  assert.equal(recovered.run.progress.uncertain, committed ? 0 : 1);
  const document = (await snapshot()).run.verificationDocument;
  await coordinator.view();
  assert.equal((await snapshot()).run.verificationDocument, document);
  assert.deepEqual(await effectCount(), { events: 1, receipts: 1 });
  await delay(250);
  assert.equal(sends, 1);
}
try {
  await boss.start();
  assert.equal((await fetch('http://127.0.0.1:3000/api/health')).status, 200);
  coordinator = new ReplayCoordinator(
    journal,
    fixture,
    producer,
    verifier,
    new DatabaseSlots(1, 15),
    instanceId,
  );
  await coordinator.initialize();
  assert.ok(Object.hasOwn(cases, process.env.NEXO_CONTROL_FAULT));
  await cases[process.env.NEXO_CONTROL_FAULT]();
  console.log('replay-control-fault-ok');
} catch {
  console.log('replay-control-fault-failed:' + stage);
} finally {
  coordinator?.close();
  await boss.stop({ graceful: false });
  await Promise.all([write.end(), read.end(), owner.end()]);
}
