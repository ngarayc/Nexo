// PostgreSQL y estados sintéticos del diario; no sustituye los24envíosHTTP.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { Pool } from 'pg';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { encodeIdentity, readObservedInstant } from '@nexo/contracts';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
import { prepareDatabase } from '/app/apps/api/dist/platform/database/prepare.js';
import { passwordHashOptions } from '/app/apps/api/dist/platform/database/password-policy.js';
import { DatabaseSlots } from '/app/apps/api/dist/platform/database/slots.js';
import { PostgresReplayJournal } from '/app/apps/api/dist/modules/demo/adapters/postgres/journal.js';
import {
  replayDiagnostic,
  ReplayConflict,
  ReplayCapacity,
  ReplayInputError,
} from '/app/apps/api/dist/modules/demo/domain/replay.js';

const write = new Pool({ ...readDatabaseConfig(process.env).pool, max: 6 });
const read = new Pool({ ...readDatabaseConfig(process.env).pool, max: 4 });
const owner = new Pool(readDatabaseConfig(process.env, true).pool);
const journal = new PostgresReplayJournal(
  write,
  read,
  new DatabaseSlots(1, 15),
  new DatabaseSlots(16, 0),
);
const peer = new PostgresReplayJournal(
  write,
  read,
  new DatabaseSlots(1, 15),
  new DatabaseSlots(16, 0),
);
const fixtureSha256 = createHash('sha256').update('synthetic-journal-policy-case').digest('hex');
const instanceId = randomUUID();
function input() {
  const runId = randomUUID();
  return {
    runId,
    scenarioId: runId,
    previousRunId: null,
    instanceId,
    fixtureSha256,
    stage: 'first',
    intervalMs: 750,
  };
}
const create = () => journal.create(input());
const transition = (view, state, extra = {}) =>
  journal.transition(view.run.runId, view.run.revision, { state, ...extra });
const start = async () => transition(await create(), 'running');
const begin = (view) =>
  journal.beginAttempt(view.run.runId, view.run.revision, randomUUID(), 'test-event');
const resolve = (view, state = 'running', outcome = 'accepted') =>
  journal.resolveAttempt(
    view.run.runId,
    view.run.revision,
    { state: 'classified', outcome, reasonCode: outcome === 'rejected' ? 'INVALID_SPEED' : null },
    { state },
  );
async function sqlRejected(operation, expected) {
  let code;
  try {
    await operation;
  } catch (error) {
    code = error.code ?? error.cause?.code;
  }
  assert.equal(code, expected, 'La protección SQL esperada debe rechazar la operación.');
}
async function full(view, second = false) {
  view = await transition(view, 'running');
  for (let line = 1; line <= 24; line++) {
    view = await begin(view);
    if (line === 24) view = await transition(view, 'pausing');
    view = await resolve(
      view,
      line === 24 ? 'paused' : 'running',
      line > 22 ? 'rejected' : second || line > 20 ? 'duplicate' : 'accepted',
    );
  }
  assert.equal(view.run.state, 'completed');
  assert.equal(view.run.nextLine, 25);
  return view;
}
const syntheticReport = JSON.stringify({
  source: 'synthetic-journal-policy',
  notHttpReplayEvidence: true,
});
function intention(runId = null, action = 'start') {
  const command = {
    commandId: randomUUID(),
    instanceId,
    expectedControlVersion: runId === null ? 0 : 1,
    runId,
    action,
  };
  return {
    commandId: command.commandId,
    instanceId,
    expectedControlVersion: command.expectedControlVersion,
    document: JSON.stringify(command),
  };
}
async function verify(view) {
  return journal.verify(view.run.runId, view.run.revision, 'conformant', syntheticReport);
}
const zeroDomain = async () => {
  const { rows } = await read.query(
    'SELECT (SELECT count(*)::int FROM ingestion_batches) AS receipts, (SELECT count(*)::int FROM telemetry_events) AS events, (SELECT count(*)::int FROM outbox_messages) AS messages',
  );
  assert.deepEqual(rows[0], { receipts: 0, events: 0, messages: 0 });
};
const cases = {
  async intention() {
    const proposal = input();
    const command = {
      commandId: randomUUID(),
      instanceId,
      expectedControlVersion: 0,
      runId: null,
      action: 'start',
      intervalMs: 750,
    };
    const intention = {
      commandId: command.commandId,
      instanceId,
      expectedControlVersion: 0,
      document: JSON.stringify(command),
    };
    for (const invalid of [
      { ...command, action: ['start'] },
      { ...command, headers: { authorization: 'synthetic-private-marker' } },
      { ...command, intervalMs: '750' },
    ]) {
      await assert.rejects(
        journal.create({
          ...proposal,
          intention: { ...intention, document: JSON.stringify(invalid) },
        }),
        ReplayInputError,
      );
    }
    let view = await journal.create({ ...proposal, intention });
    assert.deepEqual((await journal.find(view.run.runId)).run.intention, intention);
    view = await transition(view, 'running');
    assert.deepEqual(view.run.intention, intention);
    const pause = {
      commandId: randomUUID(),
      instanceId,
      expectedControlVersion: 1,
      runId: view.run.runId,
      action: 'pause',
    };
    const next = {
      commandId: pause.commandId,
      instanceId,
      expectedControlVersion: 1,
      document: JSON.stringify(pause),
    };
    view = await transition(view, 'pausing', { intention: next });
    assert.deepEqual((await journal.find(view.run.runId)).run.intention, next);
    await sqlRejected(
      owner.query(
        'UPDATE replay_runs SET last_command_document=NULL,revision=revision+1 WHERE run_id=$1',
        [view.run.runId],
      ),
      '23514',
    );
  },
  async upgrade() {
    // Esquema publicado0002 preparado con datos controlados; no se simula que
    // esta preparación manual fue una ejecución del reproductor anterior.
    const config = readDatabaseConfig(process.env, true);
    const directory = await mkdtemp(join(tmpdir(), 'nexo-replay-upgrade-'));
    try {
      await mkdir(join(directory, 'meta'));
      const metadata = JSON.parse(
        await readFile(join(config.migrationsFolder, 'meta', '_journal.json'), 'utf8'),
      );
      metadata.entries = metadata.entries.filter((entry) => entry.idx <= 2);
      for (const entry of metadata.entries)
        await copyFile(
          join(config.migrationsFolder, entry.tag + '.sql'),
          join(directory, entry.tag + '.sql'),
        );
      await writeFile(join(directory, 'meta', '_journal.json'), JSON.stringify(metadata));
      await migrate(drizzle(owner), { migrationsFolder: directory });
      await owner.query("INSERT INTO users(username,password_hash) VALUES('demo',$1)", [
        await hash('demo', passwordHashOptions),
      ]);
      const instant = readObservedInstant('2026-01-01T00:00:00Z');
      const {
        rows: [event],
      } = await owner.query(
        `INSERT INTO telemetry_events(event_key,vehicle_key,observed_at_original,observed_epoch_second,observed_fraction,latitude,longitude,speed_kph,ignition_on,payload_extra)
        VALUES($1,$2,$3,$4,$5,4,-74,81,true,'{}') RETURNING event_pk`,
        [
          Buffer.from(encodeIdentity('old-event')),
          Buffer.from(encodeIdentity('old-vehicle')),
          '2026-01-01T00:00:00Z',
          instant.epochSecond.toString(),
          instant.fraction,
        ],
      );
      await owner.query('INSERT INTO vehicle_latest(vehicle_key,event_pk) VALUES($1,$2)', [
        Buffer.from(encodeIdentity('old-vehicle')),
        event.event_pk,
      ]);
      await owner.query("INSERT INTO alerts(event_pk,type) VALUES($1,'OVERSPEED')", [
        event.event_pk,
      ]);
      const snapshot = async () =>
        JSON.stringify(
          (
            await owner.query(`SELECT
        (SELECT json_agg(u ORDER BY id) FROM users u) AS users,
        (SELECT json_agg(e ORDER BY event_pk) FROM telemetry_events e) AS events,
        (SELECT json_agg(v ORDER BY vehicle_pk) FROM vehicle_latest v) AS vehicles,
        (SELECT json_agg(a ORDER BY event_pk) FROM alerts a) AS alerts`)
          ).rows,
        );
      const before = await snapshot();
      await prepareDatabase(config);
      assert.equal(
        (await snapshot()) === before,
        true,
        'Datos anteriores comparados en memoria, sin publicar hashes o filas.',
      );
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'",
          )
        ).rows[0].count,
        9,
      );
      assert.equal((await journal.history()).items.length, 0);
      await prepareDatabase(config);
      assert.equal(
        (await snapshot()) === before,
        true,
        'Migración/seed repetidos conservan los datos anteriores.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  async constraints() {
    let view = await start();
    const ingestionId = randomUUID(),
      id = 'exact\0\ud800';
    view = await journal.beginAttempt(view.run.runId, view.run.revision, ingestionId, id);
    assert.equal(view.attempts[0].eventId, id);
    assert.equal(Object.hasOwn(view.attempts[0], 'eventKey'), false);
    await zeroDomain(); // ingestionId existe antes de cualquier recibo o evento.
    await sqlRejected(
      owner.query(
        "UPDATE replay_attempts SET state='classified',outcome='accepted',http_status=200,finalized_at=clock_timestamp() WHERE run_id=$1",
        [view.run.runId],
      ),
      '23514',
    );
    await sqlRejected(
      owner.query(
        'UPDATE replay_runs SET next_line=2,revision=revision+1,updated_at=clock_timestamp() WHERE run_id=$1',
        [view.run.runId],
      ),
      '23514',
    );
    assert.equal((await journal.find(view.run.runId)).attempts[0].state, 'in_flight');
    await sqlRejected(
      write.query('UPDATE replay_runs SET instance_id=$1 WHERE run_id=$2', [
        randomUUID(),
        view.run.runId,
      ]),
      '42501',
    );
    await sqlRejected(
      owner.query('UPDATE replay_runs SET instance_id=$1,revision=revision+1 WHERE run_id=$2', [
        randomUUID(),
        view.run.runId,
      ]),
      '23514',
    );
    await sqlRejected(
      write.query(
        'INSERT INTO replay_attempts(run_id,line_number,batch_index,ingestion_id) VALUES($1,1,1,$2)',
        [view.run.runId, randomUUID()],
      ),
      '23514',
    );
    await sqlRejected(
      write.query('INSERT INTO replay_attempts(run_id,line_number,ingestion_id) VALUES($1,2,$2)', [
        view.run.runId,
        randomUUID(),
      ]),
      '23514',
    );
    await sqlRejected(
      write.query('INSERT INTO replay_attempts(run_id,line_number,ingestion_id) VALUES($1,1,$2)', [
        randomUUID(),
        randomUUID(),
      ]),
      '23503',
    );
    await sqlRejected(
      write.query('DELETE FROM replay_runs WHERE run_id=$1', [view.run.runId]),
      '42501',
    );
    await journal.recover();
    view = await start();
    await sqlRejected(
      write.query('INSERT INTO replay_attempts(run_id,line_number,ingestion_id) VALUES($1,1,$2)', [
        view.run.runId,
        ingestionId,
      ]),
      '23505',
    );
  },
  async complete() {
    let first = await verify(await full(await create()));
    assert.deepEqual(
      [first.progress.accepted, first.progress.duplicates, first.progress.rejected],
      [20, 2, 2],
    );
    const originalReport = first.run.verificationDocument;
    await sqlRejected(
      owner.query(
        "UPDATE replay_runs SET scenario_verification='conformant',scenario_document='{}'::json,scenario_closed_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE run_id=$1",
        [first.run.runId],
      ),
      '23514',
    );
    await sqlRejected(
      owner.query(
        "UPDATE replay_runs SET verification_document='{}'::json,revision=revision+1 WHERE run_id=$1",
        [first.run.runId],
      ),
      '23514',
    );
    let second = await journal.create({
      ...input(),
      scenarioId: first.run.runId,
      previousRunId: first.run.runId,
      stage: 'second',
    });
    second = await verify(await full(second, true));
    assert.deepEqual(
      [second.progress.accepted, second.progress.duplicates, second.progress.rejected],
      [0, 22, 2],
    );
    first = await journal.closeScenario(
      first.run.runId,
      first.run.revision,
      'conformant',
      syntheticReport,
    );
    assert.equal(first.run.scenarioVerification, 'conformant');
    assert.equal(first.run.verificationDocument, originalReport);
    assert.notEqual(first.run.scenarioClosedAt, null);
    const closed = await journal.find(first.run.runId);
    const exploratory = await journal.create({
      ...input(),
      scenarioId: first.run.runId,
      previousRunId: second.run.runId,
      stage: 'exploratory',
    });
    assert.equal(exploratory.run.stage, 'exploratory');
    assert.equal(exploratory.run.previousRunId, second.run.runId);
    assert.deepEqual(await journal.find(first.run.runId), closed);
    await zeroDomain(); // Solo prueba política del diario; no fue un replay real.
  },
  async concurrency() {
    const pair = await Promise.allSettled([create(), peer.create(input())]);
    assert.equal(pair.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      pair.filter(
        (result) => result.status === 'rejected' && result.reason instanceof ReplayConflict,
      ).length,
      1,
    );
    let view = pair.find((result) => result.status === 'fulfilled').value;
    view = await transition(view, 'running');
    const controls = await Promise.allSettled([
      transition(view, 'pausing'),
      peer.transition(view.run.runId, view.run.revision, { state: 'restarting' }),
    ]);
    assert.equal(controls.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      controls.filter(
        (result) => result.status === 'rejected' && result.reason instanceof ReplayConflict,
      ).length,
      1,
    );
    assert.equal((await journal.find(view.run.runId)).run.revision, view.run.revision + 1);
  },
  async rollback() {
    let view = await begin(await start());
    await owner.query(`CREATE FUNCTION public.nexo_test_replay_fail() RETURNS trigger LANGUAGE plpgsql AS $test$
      BEGIN IF NEW.next_line > OLD.next_line THEN RAISE EXCEPTION 'synthetic replay failure'; END IF; RETURN NEW; END $test$;
      CREATE TRIGGER nexo_test_replay_fail BEFORE UPDATE ON replay_runs FOR EACH ROW EXECUTE FUNCTION public.nexo_test_replay_fail();`);
    try {
      await assert.rejects(resolve(view));
      const unchanged = await journal.find(view.run.runId);
      assert.equal(unchanged.run.revision, view.run.revision);
      assert.equal(unchanged.run.nextLine, 1);
      assert.equal(unchanged.attempts[0].state, 'in_flight');
      assert.equal(unchanged.progress.classified, 0);
    } finally {
      await owner.query(
        'DROP TRIGGER nexo_test_replay_fail ON replay_runs; DROP FUNCTION public.nexo_test_replay_fail();',
      );
    }
    view = await resolve(view);
    assert.equal(view.run.nextLine, 2);
    assert.equal(view.progress.accepted, 1);
  },
  async recovery() {
    const completed = await verify(await full(await create()));
    let view = await resolve(await begin(await start()));
    view = await transition(await transition(view, 'pausing'), 'paused');
    assert.equal(await journal.recover(), 1);
    const interrupted = await journal.find(view.run.runId);
    assert.equal(interrupted.run.state, 'interrupted');
    assert.equal(interrupted.run.verification, 'inconclusive');
    assert.equal(interrupted.progress.accepted, 1);
    assert.deepEqual(await journal.find(completed.run.runId), completed);
    view = await begin(await start());
    assert.equal(await journal.recover(), 1);
    const uncertain = await journal.find(view.run.runId);
    assert.equal(uncertain.attempts[0].state, 'uncertain');
    assert.equal(uncertain.progress.classified, 0);
    assert.equal(uncertain.progress.uncertain, 1);
    assert.equal(await journal.recover(), 0);
    await assert.rejects(resolve(uncertain), ReplayConflict);
    await zeroDomain();
  },
  async diagnostics() {
    const view = await begin(await start());
    for (const document of [
      '{"code":"TRANSPORT_UNCERTAIN","truncated":false,"headers":"synthetic-private-marker"}',
      JSON.stringify({ code: 'TRANSPORT_UNCERTAIN', truncated: false, stack: 'x'.repeat(4096) }),
    ]) {
      await assert.rejects(
        journal.resolveAttempt(
          view.run.runId,
          view.run.revision,
          { state: 'uncertain', httpStatus: null, diagnosticDocument: document },
          { state: 'error', closeCode: 'TRANSPORT_UNCERTAIN' },
        ),
        ReplayInputError,
      );
      assert.equal((await journal.find(view.run.runId)).attempts[0].state, 'in_flight');
    }
    const result = await journal.resolveAttempt(
      view.run.runId,
      view.run.revision,
      {
        state: 'uncertain',
        httpStatus: 503,
        diagnosticDocument: replayDiagnostic('TRANSPORT_UNCERTAIN', {
          admission: 'unknown',
          httpStatus: 503,
        }),
      },
      { state: 'error', closeCode: 'TRANSPORT_UNCERTAIN' },
    );
    assert.equal(result.progress.uncertain, 1);
    assert.equal(result.progress.classified, 0);
    assert.equal(result.progress.unattempted, 23);
    await sqlRejected(
      owner.query(
        "UPDATE replay_attempts SET state='classified',outcome='accepted',http_status=200 WHERE run_id=$1",
        [view.run.runId],
      ),
      '23514',
    );
    assert.equal((await journal.find(view.run.runId)).attempts[0].state, 'uncertain');
  },
  async history() {
    for (let i = 0; i < 3; i++) {
      await create();
      await journal.recover();
    }
    const older = randomUUID(),
      newer = randomUUID();
    for (const [runId, microsecond] of [
      [older, '000001'],
      [newer, '000002'],
    ]) {
      await owner.query(
        `INSERT INTO replay_runs(run_id,scenario_id,instance_id,fixture_sha256,stage,created_at,updated_at) VALUES($1,$1,$2,$3,'first',$4,$4)`,
        [runId, instanceId, fixtureSha256, '2025-01-01T00:00:00.' + microsecond + 'Z'],
      );
      await owner.query(
        "UPDATE replay_runs SET state='interrupted',verification='inconclusive',close_code='API_RESTARTED',revision=revision+1,updated_at=clock_timestamp() WHERE run_id=$1",
        [runId],
      );
    }
    const ids = [];
    let cursor;
    do {
      const page = await journal.history(1, cursor);
      assert.equal(page.items.length, 1);
      ids.push(page.items[0].runId);
      cursor = page.nextCursor ?? undefined;
      assert.ok(ids.length <= 100);
    } while (cursor);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.indexOf(newer) < ids.indexOf(older));
    assert.equal((await journal.find(newer)).run.createdAt, '2025-01-01T00:00:00.000002Z');
    for (const limit of [0, 101, 1.5, '20'])
      await assert.rejects(journal.history(limit), ReplayInputError);
    for (const cursor of [
      '!',
      'a'.repeat(257),
      Buffer.from(
        '{"createdAt":"2025-02-30T00:00:00.000001Z","runId":"' + randomUUID() + '"}',
      ).toString('base64url'),
    ])
      await assert.rejects(journal.history(20, cursor), ReplayInputError);
  },
  async terminal_report() {
    let view = await begin(await start());
    const original = await journal.find(view.run.runId);
    await assert.rejects(
      transition(view, 'pausing', {
        finalVerification: { result: 'inconclusive', document: syntheticReport },
      }),
      ReplayConflict,
    );
    await assert.rejects(
      transition(view, 'error', {
        finalVerification: { result: 'inconclusive', document: '[]' },
      }),
      ReplayInputError,
    );
    assert.deepEqual(await journal.find(view.run.runId), original);
    view = await journal.resolveAttempt(
      view.run.runId,
      view.run.revision,
      {
        state: 'uncertain',
        httpStatus: null,
        diagnosticDocument: replayDiagnostic('RESPONSE_PENDING'),
      },
      {
        state: 'error',
        closeCode: 'RESPONSE_PENDING',
        finalVerification: { result: 'inconclusive', document: syntheticReport },
      },
    );
    assert.equal(view.run.state, 'error');
    assert.equal(view.run.verification, 'inconclusive');
    assert.equal(view.run.verificationDocument, syntheticReport);
    assert.equal(view.run.nextLine, 1);
    assert.equal(view.attempts[0].state, 'uncertain');
    assert.equal(view.progress.classified, 0);
    await assert.rejects(verify(view), ReplayConflict);
    await sqlRejected(
      owner.query(
        "UPDATE replay_runs SET verification_document='{}'::json,revision=revision+1 WHERE run_id=$1",
        [view.run.runId],
      ),
      '23514',
    );
    view = await transition(await start(), 'error', {
      closeCode: 'RESPONSE_INVALID',
      finalVerification: { result: 'non_conformant', document: syntheticReport },
    });
    assert.equal(view.run.verification, 'non_conformant');
    assert.equal((await journal.find(view.run.runId)).run.verificationDocument, syntheticReport);
    await zeroDomain();
  },
  async confirmation() {
    for (const operation of ['create', 'transition']) {
      for (const committed of [false, true]) {
        const lossyPool = {
          async connect() {
            const client = await write.connect();
            return new Proxy(client, {
              get(target, property) {
                if (property === 'query')
                  return async (...args) => {
                    if (args[0] === 'COMMIT') {
                      if (committed) await target.query('COMMIT');
                      throw new Error('synthetic-lost-commit-response');
                    }
                    return target.query(...args);
                  };
                const value = Reflect.get(target, property);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          },
        };
        const lossy = new PostgresReplayJournal(
          lossyPool,
          read,
          new DatabaseSlots(1, 15),
          new DatabaseSlots(16, 0),
        );
        let runId, previousRevision, marker;
        if (operation === 'create') {
          const proposal = input();
          runId = proposal.runId;
          previousRevision = null;
          marker = intention();
          await assert.rejects(lossy.create({ ...proposal, intention: marker }));
        } else {
          const view = await start();
          runId = view.run.runId;
          previousRevision = view.run.revision;
          marker = intention(runId, 'pause');
          await assert.rejects(
            lossy.transition(runId, previousRevision, { state: 'pausing', intention: marker }),
          );
        }
        const result = await journal.confirmIntention(runId, previousRevision, marker);
        assert.equal(result.state, committed ? 'applied' : 'not_applied');
        if (committed) assert.deepEqual(result.snapshot.run.intention, marker);
        else if (operation === 'create') assert.equal(result.snapshot, null);
        else assert.equal(result.snapshot.run.revision, previousRevision);
        await journal.recover();
      }
    }
    const marker = intention();
    assert.equal((await journal.confirmIntention(randomUUID(), 1, marker)).state, 'unknown');
    const view = await start();
    assert.equal((await journal.confirmIntention(view.run.runId, null, marker)).state, 'unknown');
    await zeroDomain();
  },
  async confirmation_barrier() {
    for (const committed of [true, false]) {
      const proposal = input(),
        marker = intention(),
        client = await owner.connect();
      let pending;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(72416003)');
        await client.query(
          `INSERT INTO replay_runs(run_id,scenario_id,instance_id,fixture_sha256,stage,
            last_command_id,last_command_instance,last_command_expected_version,last_command_document)
            VALUES($1,$1,$2,$3,'first',$4,$2,0,$5::json)`,
          [proposal.runId, instanceId, fixtureSha256, marker.commandId, marker.document],
        );
        assert.equal(await journal.find(proposal.runId), undefined);
        pending = journal.confirmIntention(proposal.runId, null, marker);
        // Retener el rechazo mientras se observa el bloqueo evita una promesa
        // no manejada si falla la comprobación; no convierte el fallo en éxito.
        pending.catch(() => {});
        const deadline = Date.now() + 500;
        let blocked = false;
        do {
          blocked = (
            await read.query(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=72416003 AND NOT granted) AS blocked",
            )
          ).rows[0].blocked;
          if (!blocked) await pause(10);
        } while (!blocked && Date.now() < deadline);
        assert.equal(blocked, true, 'La confirmación debe esperar la transacción anterior.');
        await client.query(committed ? 'COMMIT' : 'ROLLBACK');
        const result = await pending;
        assert.equal(result.state, committed ? 'applied' : 'not_applied');
        if (committed) assert.deepEqual(result.snapshot.run.intention, marker);
        else assert.equal(result.snapshot, null);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        await pending?.catch(() => {});
      }
      await journal.recover();
    }
    await zeroDomain();
  },
  async capacity() {
    // Filas interrumpidas sintéticas reservan24posiciones sin fingir envíos.
    await owner.query(`DO $test$ DECLARE id uuid; BEGIN
      WHILE (SELECT count(*) FROM replay_runs)<999 LOOP
        id:=gen_random_uuid();
        INSERT INTO replay_runs(run_id,scenario_id,instance_id,fixture_sha256,stage) VALUES(id,id,gen_random_uuid(),repeat('a',64),'first');
        UPDATE replay_runs SET state='interrupted',verification='inconclusive',close_code='API_RESTARTED',revision=revision+1,updated_at=clock_timestamp() WHERE run_id=id;
      END LOOP; END $test$;`);
    const pair = await Promise.allSettled([create(), peer.create(input())]);
    assert.equal(pair.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      pair.filter(
        (result) => result.status === 'rejected' && result.reason instanceof ReplayCapacity,
      ).length,
      1,
    );
    assert.equal(
      (await read.query('SELECT count(*)::int AS count FROM replay_runs')).rows[0].count,
      1000,
    );
    assert.equal((await journal.history(100)).items.length, 100);
    assert.equal(await journal.recover(), 1);
    await assert.rejects(create(), ReplayCapacity);
  },
};
try {
  const selected = cases[process.env.NEXO_REPLAY_CASE];
  assert.equal(typeof selected, 'function');
  await selected();
  await journal.recover();
  console.log('replay-journal-case-ok');
} finally {
  await Promise.all([write.end(), read.end(), owner.end()]);
}
