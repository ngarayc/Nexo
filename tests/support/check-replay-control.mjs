// Motor, HTTP, sesión y PostgreSQL reales. Dos streams Node no acreditan render.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';

const pool = new Pool(readDatabaseConfig(process.env, true).pool);
const origin = process.env.PUBLIC_ORIGIN;
const base = 'http://127.0.0.1:3000/api';
let stage = 'session';
const nativeFetch = (path, init = {}) =>
  fetch(base + path, { ...init, signal: AbortSignal.timeout(15000) });
async function session() {
  const response = await nativeFetch('/session', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{"username":"demo","password":"demo"}',
  });
  assert.equal(response.status, 200);
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    csrf: (await response.json()).csrfToken,
  };
}
async function read(own, query = '') {
  const response = await nativeFetch('/demo/replay' + query, { headers: { Cookie: own.cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  return response.json();
}
async function send(own, command) {
  const response = await nativeFetch('/demo/replay/commands', {
    method: 'POST',
    headers: {
      Cookie: own.cookie,
      Origin: origin,
      'X-CSRF-Token': own.csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: await response.json() };
}
async function order(own, action, intervalMs) {
  const view = await read(own);
  return {
    commandId: randomUUID(),
    instanceId: view.instanceId,
    expectedControlVersion: view.controlVersion,
    runId: view.run?.runId ?? null,
    action,
    ...(intervalMs === undefined ? {} : { intervalMs }),
  };
}
async function waitFor(own, predicate, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const view = await read(own);
    if (predicate(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('synthetic-control-condition-timeout');
}
async function counts() {
  return (
    await pool.query(`SELECT (SELECT count(*)::int FROM telemetry_events) AS events,
    (SELECT count(*)::int FROM vehicle_latest) AS vehicles,(SELECT count(*)::int FROM alerts) AS alerts,
    (SELECT count(*)::int FROM outbox_messages) AS messages,(SELECT count(*)::int FROM ingestion_batches) AS receipts`)
  ).rows[0];
}
async function stream(own) {
  const controller = new globalThis.AbortController(),
    frames = [];
  const response = await fetch(base + '/stream', {
    headers: { Cookie: own.cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const pending = (async () => {
    let buffer = '';
    try {
      for await (const chunk of response.body) {
        buffer += Buffer.from(chunk).toString('utf8');
        assert.ok(buffer.length < 1024 * 1024);
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end < 0) break;
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith('event:demo.replay.updated\n'))
            frames.push(JSON.parse(frame.split('\ndata:')[1]));
        }
      }
    } catch {
      if (!controller.signal.aborted) throw new Error('synthetic-stream-failed');
    }
  })();
  return {
    frames,
    close: async () => {
      controller.abort();
      await pending;
    },
  };
}
const cases = {
  async official() {
    const first = await session(),
      second = await session();
    const one = await stream(first),
      two = await stream(second);
    try {
      stage = 'start';
      const start = await order(first, 'start', 100);
      const admission = await send(first, start);
      assert.equal(admission.status, 202);
      assert.equal((await send(first, start)).body.runId, admission.body.runId);
      const running = await waitFor(
        first,
        (v) => v.run?.state === 'running' && v.run.progress.classified >= 2,
      );
      stage = 'concurrent-pause';
      const pause = { ...(await order(first, 'pause')) };
      const pair = await Promise.all([
        send(first, pause),
        send(second, { ...pause, commandId: randomUUID() }),
      ]);
      assert.deepEqual(pair.map((item) => item.status).sort(), [202, 409]);
      const paused = await waitFor(first, (v) => v.run?.state === 'paused');
      assert.equal(paused.run.progress.inFlight, 0);
      const prefix = await counts();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.deepEqual(await counts(), prefix);
      assert.equal((await read(second)).run.runId, paused.run.runId);
      stage = 'resume';
      const resume = await send(second, await order(second, 'resume', 100));
      assert.equal(resume.status, 202);
      const completed = await waitFor(
        first,
        (v) => v.run?.state === 'completed' && v.run.verification !== 'pending',
      );
      assert.equal(completed.run.verification, 'conformant');
      assert.deepEqual(
        [
          completed.run.progress.accepted,
          completed.run.progress.duplicates,
          completed.run.progress.rejected,
        ],
        [20, 2, 2],
      );
      assert.equal(completed.instanceId, running.instanceId);
      assert.deepEqual(await counts(), {
        events: 20,
        vehicles: 8,
        alerts: 4,
        messages: 43,
        receipts: 24,
      });
      const firstId = completed.run.runId;
      const original = await read(first, '?runId=' + firstId);
      assert.equal(original.inspection.report.result, 'conformant');
      assert.equal(original.attempts.length, 24);
      assert.equal(original.attempts[21].reasonCode, 'INVALID_LATITUDE');
      assert.equal(original.attempts[22].reasonCode, 'INVALID_SPEED');
      stage = 'second';
      assert.equal((await send(first, await order(first, 'restart', 100))).status, 202);
      const repeated = await waitFor(
        first,
        (v) =>
          v.run?.stage === 'second' &&
          v.run.state === 'completed' &&
          v.run.verification !== 'pending',
      );
      assert.equal(repeated.run.verification, 'conformant');
      assert.notEqual(repeated.run.runId, firstId);
      assert.deepEqual(
        [
          repeated.run.progress.accepted,
          repeated.run.progress.duplicates,
          repeated.run.progress.rejected,
        ],
        [0, 22, 2],
      );
      assert.deepEqual(await counts(), {
        events: 20,
        vehicles: 8,
        alerts: 4,
        messages: 43,
        receipts: 48,
      });
      stage = 'finish';
      assert.equal((await send(second, await order(second, 'finishVerification'))).status, 202);
      const closed = await waitFor(first, (v) => Boolean(v.scenario?.closedAt));
      assert.equal(closed.scenario.verification, 'conformant');
      assert.deepEqual(closed.allowedActions, ['restart']);
      const preserved = await read(first, '?runId=' + firstId);
      assert.deepEqual(preserved.inspection.report, original.inspection.report);
      assert.equal(preserved.scenario.report.result, 'conformant');
      stage = 'shared-streams';
      await new Promise((resolve) => setTimeout(resolve, 2100));
      for (const observed of [one.frames, two.frames]) {
        assert.ok(observed.some((frame) => frame.run?.progress.classified > 0));
        assert.ok(observed.some((frame) => frame.scenario?.verification === 'conformant'));
        assert.ok(
          observed.every(
            (frame) =>
              frame.instanceId === completed.instanceId &&
              frame.streamInstanceId !== frame.instanceId,
          ),
        );
        const revisions = observed.map((frame) => frame.viewRevision);
        assert.deepEqual(
          revisions,
          [...revisions].sort((a, b) => a - b),
        );
      }
      stage = 'history-and-diagnostics';
      const history = await read(first, '?view=history&limit=1');
      assert.equal(history.items.length, 1);
      assert.equal(typeof history.nextCursor, 'string');
      const next = await read(first, '?view=history&limit=1&cursor=' + history.nextCursor);
      assert.equal(next.items[0].runId, firstId);
      for (const runId of [firstId, repeated.run.runId]) {
        const detail = await read(first, '?runId=' + runId);
        assert.ok(!JSON.stringify(detail).includes(process.env.INGEST_API_KEY));
        assert.equal(detail.run.intention, undefined);
        assert.equal(detail.run.verificationDocument, undefined);
      }
      stage = 'explore-after-closure';
      const rootBefore = (
        await pool.query(
          'SELECT verification_document::text,scenario_document::text,scenario_closed_at FROM replay_runs WHERE run_id=$1',
          [firstId],
        )
      ).rows[0];
      assert.equal(
        (await send(first, { ...(await order(first, 'start', 100)), runId: null })).status,
        409,
      );
      stage = 'explore-admission';
      const again = await order(first, 'restart', 100);
      const extra = await send(first, again);
      assert.equal(extra.status, 202);
      assert.equal((await send(first, again)).body.runId, extra.body.runId);
      const explored = await waitFor(
        first,
        (v) =>
          v.run?.stage === 'exploratory' &&
          v.run.state === 'completed' &&
          v.run.verification !== 'pending',
      );
      assert.deepEqual(
        [
          explored.run.progress.accepted,
          explored.run.progress.duplicates,
          explored.run.progress.rejected,
        ],
        [0, 22, 2],
      );
      stage = 'explore-outcomes';
      assert.equal(explored.scenario.verification, 'conformant');
      assert.equal(explored.scenario.closedAt, closed.scenario.closedAt);
      assert.equal(explored.run.verification, 'inconclusive');
      assert.deepEqual(await counts(), {
        events: 20,
        vehicles: 8,
        alerts: 4,
        messages: 43,
        receipts: 72,
      });
      stage = 'explore-sql-flag';
      const suffix = (
        await pool.query('SELECT post_closure FROM replay_runs WHERE run_id=$1', [
          explored.run.runId,
        ])
      ).rows[0];
      assert.equal(suffix.post_closure, true);
      stage = 'explore-immutable-flag';
      await assert.rejects(
        pool.query(
          'UPDATE replay_runs SET post_closure=false,revision=revision+1,updated_at=clock_timestamp() WHERE run_id=$1',
          [explored.run.runId],
        ),
        (error) => error.code === '23514',
      );
      stage = 'explore-no-official-second';
      await assert.rejects(
        pool.query(
          "INSERT INTO replay_runs(run_id,scenario_id,previous_run_id,instance_id,fixture_sha256,stage) SELECT $1,scenario_id,run_id,instance_id,fixture_sha256,'second' FROM replay_runs WHERE run_id=$2",
          [randomUUID(), explored.run.runId],
        ),
        (error) => error.code === '23514',
      );
      stage = 'stop-exploration-without-reclosing';
      assert.equal((await send(first, await order(first, 'restart', 500))).status, 202);
      await waitFor(
        first,
        (v) =>
          v.run?.stage === 'exploratory' &&
          v.run.state === 'running' &&
          v.run.progress.classified >= 1,
      );
      assert.equal((await send(second, await order(second, 'finishVerification'))).status, 202);
      const stopped = await waitFor(
        first,
        (v) => v.run?.state === 'stopped' && v.pendingAction === null,
      );
      assert.deepEqual(stopped.allowedActions, ['restart']);
      assert.deepEqual(
        (
          await pool.query(
            'SELECT verification_document::text,scenario_document::text,scenario_closed_at FROM replay_runs WHERE run_id=$1',
            [firstId],
          )
        ).rows[0],
        rootBefore,
      );
      const final = await read(first, '?runId=' + firstId);
      assert.deepEqual(final.inspection.report, original.inspection.report);
      assert.deepEqual(final.scenario.report, preserved.scenario.report);
    } finally {
      await one.close();
      await two.close();
    }
  },
  async partial() {
    const own = await session();
    assert.equal((await send(own, await order(own, 'start', 500))).status, 202);
    const first = await waitFor(own, (v) => v.run?.progress.classified >= 1);
    stage = 'partial-restart';
    assert.equal((await send(own, await order(own, 'restart', 100))).status, 202);
    const restarted = await waitFor(
      own,
      (v) => v.run?.stage === 'exploratory' && v.run.progress.classified >= 1,
    );
    const preserved = await read(own, '?runId=' + first.run.runId);
    assert.equal(preserved.run.state, 'stopped');
    assert.equal(preserved.run.verification, 'inconclusive');
    assert.notEqual(restarted.run.runId, first.run.runId);
    assert.equal(restarted.run.scenarioId, first.run.scenarioId);
    stage = 'partial-finish';
    assert.equal((await send(own, await order(own, 'finishVerification'))).status, 202);
    const closed = await waitFor(own, (v) => Boolean(v.scenario?.closedAt));
    assert.equal(closed.scenario.verification, 'inconclusive');
    assert.equal(closed.run.verification, 'inconclusive');
    const before = await counts();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(await counts(), before);
  },
  async prepare_restart() {
    const own = await session();
    assert.equal((await send(own, await order(own, 'start', 500))).status, 202);
    await waitFor(own, (v) => v.run?.progress.classified >= 1);
    stage = 'pause-before-api-restart';
    assert.equal((await send(own, await order(own, 'pause'))).status, 202);
    const paused = await waitFor(own, (v) => v.run?.state === 'paused');
    const before = await counts();
    assert.ok(before.events > 0 && before.events < 20);
    assert.equal(paused.run.progress.inFlight, 0);
  },
  async after_restart() {
    const own = await session();
    stage = 'recovered-without-dispatch';
    const recovered = await read(own);
    assert.equal(recovered.run.state, 'interrupted');
    assert.equal(recovered.run.verification, 'inconclusive');
    assert.equal(recovered.run.closeCode, 'API_RESTARTED');
    assert.ok(!recovered.allowedActions.includes('resume'));
    const before = await counts();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.deepEqual(await counts(), before);
  },
};
try {
  assert.ok(Object.hasOwn(cases, process.env.NEXO_CONTROL_CASE));
  await cases[process.env.NEXO_CONTROL_CASE]();
  console.log('replay-control-case-ok');
} catch {
  // Lista cerrada de etapas, sin error SQL, payload, cookies o secretos.
  console.log('replay-control-case-failed:' + stage);
} finally {
  await pool.end();
}
