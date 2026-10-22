import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSlots } from '../../../platform/database/slots.js';
import { FileOfficialSources } from '../adapters/files/official-sources.js';
import { LoadOfficialFixture } from './official-fixture.js';
import type { OfficialFixture } from './official-fixture.js';
import type { ReplayJournal, ReplaySnapshot } from './journal.js';
import type { ReplayDelivery, SendReplayLine } from './send-replay-line.js';
import type { ReplayReport } from './verification.js';
import { ReplayCoordinator, ReplayPreconditionsFailed } from './replay-coordinator.js';
import { ReplayAdmissionUnknown } from './admit-command.js';
import { replayProgress, ReplayConflict } from '../domain/replay.js';

// Diario y verificador controlados para carreras del actor. No es evidencia SQL,
// HTTP, conformidad del fixture o renderizado; esas fronteras tienen otros casos.
let fixture: OfficialFixture;
beforeAll(async () => {
  fixture = await new LoadOfficialFixture(new FileOfficialSources()).load();
});
const all: ReplayCoordinator[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const item of all.splice(0)) item.close();
  vi.useRealTimers();
});
const accepted: ReplayDelivery = { state: 'classified', outcome: 'accepted', reasonCode: null };
function report(): ReplayReport {
  return {
    version: 1,
    scope: 'data-and-replays',
    phase: 'preparation',
    result: 'conformant',
    observedAt: null,
    attemptedAt: new Date().toISOString(),
    runId: null,
    scenarioId: null,
    runRevision: null,
    environment: null,
    sources: fixture.hashes,
    snapshotFingerprint: null,
    checks: [
      {
        key: 'controlled',
        label: 'Preparación controlada',
        source: 'fixture unitario',
        expected: true,
        observed: true,
        state: 'matches',
      },
    ],
    externalEvidence: {
      twoRenderedClients: 'not_assessed',
      pauseResume: 'not_assessed',
      ci: 'not_assessed',
      video: 'not_assessed',
    },
  };
}
function memoryJournal() {
  let snapshot: ReplaySnapshot | undefined;
  const runs = new Map<string, ReplaySnapshot>();
  const current = () => snapshot!;
  const update = (
    change: Partial<ReplaySnapshot['run']>,
    attempts = current().attempts,
  ): ReplaySnapshot => {
    snapshot = {
      run: { ...current().run, ...change, revision: current().run.revision + 1 },
      attempts,
      progress: replayProgress(attempts),
    };
    runs.set(snapshot.run.runId, snapshot);
    return snapshot;
  };
  const journal: ReplayJournal = {
    create: vi.fn(async (input) => {
      snapshot = {
        run: {
          ...input,
          revision: 0,
          state: 'preparing',
          nextLine: 1,
          verification: 'pending',
          verificationDocument: null,
          scenarioVerification: 'pending',
          scenarioDocument: null,
          scenarioClosedAt: null,
          closeCode: null,
          intention: input.intention ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        attempts: [],
        progress: replayProgress([]),
      };
      runs.set(snapshot.run.runId, snapshot);
      return snapshot;
    }),
    find: vi.fn(async (runId) => runs.get(runId)),
    current: vi.fn(async () => snapshot),
    history: vi.fn(async () => ({ items: [], nextCursor: null })),
    confirmIntention: vi.fn(),
    transition: vi.fn(async (_runId, _revision, change) =>
      update({
        state: change.state,
        ...(change.intervalMs === undefined ? {} : { intervalMs: change.intervalMs }),
        ...(change.intention === undefined ? {} : { intention: change.intention }),
        ...(change.closeCode === undefined ? {} : { closeCode: change.closeCode }),
        ...(change.finalVerification
          ? {
              verification: change.finalVerification.result,
              verificationDocument: change.finalVerification.document,
            }
          : {}),
      }),
    ),
    beginAttempt: vi.fn(async (runId, _revision, ingestionId, eventId) =>
      update({}, [
        ...current().attempts,
        {
          runId,
          lineNumber: current().run.nextLine,
          batchIndex: 0,
          ingestionId,
          eventId,
          state: 'in_flight',
          outcome: null,
          reasonCode: null,
          httpStatus: null,
          diagnosticDocument: null,
          startedAt: new Date().toISOString(),
          finalizedAt: null,
        },
      ]),
    ),
    resolveAttempt: vi.fn(async (_runId, _revision, result, change) => {
      const nextLine = current().run.nextLine + (result.state === 'classified' ? 1 : 0);
      return update(
        {
          state: nextLine === 25 ? 'completed' : change.state,
          nextLine,
          ...(change.closeCode ? { closeCode: change.closeCode } : {}),
          ...(change.finalVerification
            ? {
                verification: change.finalVerification.result,
                verificationDocument: change.finalVerification.document,
              }
            : {}),
        },
        current().attempts.map((attempt, index) =>
          index !== current().attempts.length - 1
            ? attempt
            : {
                ...attempt,
                ...result,
                finalizedAt: new Date().toISOString(),
              },
        ),
      );
    }),
    verify: vi.fn(async (_runId, _revision, result, document) =>
      update({ verification: result, verificationDocument: document }),
    ),
    closeScenario: vi.fn(async (runId, _revision, result, document) => {
      const prior = runs.get(runId)!;
      const closed: ReplaySnapshot = {
        ...prior,
        run: {
          ...prior.run,
          revision: prior.run.revision + 1,
          scenarioVerification: result,
          scenarioDocument: document,
          scenarioClosedAt: new Date().toISOString(),
        },
      };
      runs.set(runId, closed);
      if (snapshot?.run.runId === runId) snapshot = closed;
      return closed;
    }),
    recover: vi.fn(async () => {
      if (
        !snapshot ||
        ['completed', 'stopped', 'error', 'interrupted'].includes(snapshot.run.state)
      )
        return 0;
      update(
        { state: 'interrupted', verification: 'inconclusive', closeCode: 'API_RESTARTED' },
        snapshot.attempts.map((a) => (a.state === 'in_flight' ? { ...a, state: 'uncertain' } : a)),
      );
      return 1;
    }),
  };
  return {
    journal,
    current,
    seed: (value: ReplaySnapshot) => {
      snapshot = value;
      runs.set(value.run.runId, value);
    },
  };
}
function setup(changed: () => void = () => {}) {
  const memory = memoryJournal();
  const producer = { send: vi.fn<SendReplayLine['send']>().mockResolvedValue(accepted) };
  const verifier = {
    prepare: vi.fn(async () => report()),
    evaluate: vi.fn(async () => report()),
    prepareSecond: vi.fn(async () => report()),
    prepareContinuation: vi.fn(async () => report()),
    evaluateScenario: vi.fn<() => Promise<ReplayReport>>(async () => ({
      ...report(),
      result: 'inconclusive' as const,
      checks: [{ ...report().checks[0]!, state: 'unavailable' as const }],
    })),
  };
  const coordinator = new ReplayCoordinator(
    memory.journal,
    fixture,
    producer,
    verifier,
    new DatabaseSlots(1, 15),
    randomUUID(),
    changed,
  );
  all.push(coordinator);
  return { ...memory, producer, verifier, coordinator };
}
async function order(
  coordinator: ReplayCoordinator,
  action: 'start' | 'pause' | 'resume' | 'restart' | 'finishVerification',
  intervalMs?: number,
) {
  const view = await coordinator.view();
  return {
    commandId: randomUUID(),
    instanceId: view.instanceId,
    expectedControlVersion: view.controlVersion,
    runId: view.run?.runId ?? null,
    action,
    ...(intervalMs === undefined ? {} : { intervalMs }),
  };
}
async function start(coordinator: ReplayCoordinator) {
  await coordinator.initialize();
  const command = await order(coordinator, 'start');
  const admission = await coordinator.command(command);
  await vi.advanceTimersByTimeAsync(0);
  return { command, admission };
}
describe('coordinación corta de inicio, pausa y reanudación (sin rutas públicas)', () => {
  it('inicializar no envía; inicio comprueba preparación antes y después de admitir', async () => {
    const { coordinator, producer, verifier, journal } = setup();
    await coordinator.initialize();
    expect(producer.send).not.toHaveBeenCalled();
    const command = await order(coordinator, 'start');
    const admission = await coordinator.command(command);
    expect(admission.accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(verifier.prepare.mock.calls).toHaveLength(2);
    expect(vi.mocked(journal.create)).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.send.mock.calls[0]![0]).toEqual(fixture.rows[0]);
  });
  it('un avance de línea cambia la vista sin invalidar controlVersion de otro cliente', async () => {
    const { coordinator, producer } = setup();
    await start(coordinator);
    const first = await coordinator.view();
    await vi.advanceTimersByTimeAsync(750);
    const second = await coordinator.view();
    expect(producer.send).toHaveBeenCalledTimes(2);
    expect(second.controlVersion).toBe(first.controlVersion);
    expect(second.viewRevision).toBeGreaterThan(first.viewRevision);
    expect(second.run?.progress.classified).toBe(2);
  });
  it('pausar confirma intención, espera HTTP sin abortarlo y reanuda desde la siguiente línea', async () => {
    const { coordinator, producer } = setup();
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await start(coordinator);
    const signal = producer.send.mock.calls[0]![2];
    const pause = await order(coordinator, 'pause');
    await coordinator.command(pause);
    expect((await coordinator.view()).run?.state).toBe('pausing');
    expect(coordinator.admissions.receipts.get(pause.commandId)?.resolution).toBe('pending');
    await vi.advanceTimersByTimeAsync(5000);
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    respond(accepted);
    await vi.advanceTimersByTimeAsync(0);
    expect((await coordinator.view()).run?.state).toBe('paused');
    expect(coordinator.admissions.receipts.get(pause.commandId)?.resolution).toBe('completed');
    await coordinator.command(await order(coordinator, 'resume', 1000));
    await vi.advanceTimersByTimeAsync(999);
    expect(producer.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(producer.send.mock.calls[1]![0]).toEqual(fixture.rows[1]);
  });
  it('dos órdenes sobre una revisión tienen un ganador; repetir ese ID no repite la transición', async () => {
    const { coordinator, journal } = setup();
    await start(coordinator);
    const pause = await order(coordinator, 'pause');
    const pair = await Promise.allSettled([
      coordinator.command(pause),
      coordinator.command({ ...pause, commandId: randomUUID() }),
    ]);
    expect(pair.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(pair.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const before = vi.mocked(journal.transition).mock.calls.length;
    await coordinator.command(pause);
    expect(vi.mocked(journal.transition).mock.calls).toHaveLength(before);
    await expect(coordinator.command({ ...pause, intervalMs: 100 })).rejects.toThrow();
  });
  it('precondición inicial fallida no crea ejecución o envío', async () => {
    const { coordinator, verifier, producer, journal } = setup();
    await coordinator.initialize();
    verifier.prepare.mockResolvedValueOnce({ ...report(), result: 'inconclusive' });
    await expect(coordinator.command(await order(coordinator, 'start'))).rejects.toThrow(
      ReplayPreconditionsFailed,
    );
    expect(journal.create).not.toHaveBeenCalled();
    expect(producer.send).not.toHaveBeenCalled();
  });
  it('interferencia durante preparación deja cierre no conforme con informe y ningún envío', async () => {
    const { coordinator, verifier, producer, journal } = setup();
    verifier.prepare.mockResolvedValueOnce(report()).mockResolvedValueOnce({
      ...report(),
      result: 'non_conformant',
      checks: [{ ...report().checks[0]!, state: 'differs' }],
    });
    await start(coordinator);
    const view = await coordinator.view();
    expect(view.run?.state).toBe('error');
    expect(view.run?.verification).toBe('non_conformant');
    expect(producer.send).not.toHaveBeenCalled();
    expect(vi.mocked(journal.transition).mock.calls[0]![2].finalVerification?.document).toContain(
      'non_conformant',
    );
  });
  it('respuesta incierta detiene sin convertirla en rechazo ni volver a enviar', async () => {
    const { coordinator, producer } = setup();
    producer.send.mockResolvedValueOnce({
      state: 'uncertain',
      closeCode: 'TRANSPORT_UNCERTAIN',
      httpStatus: null,
      diagnosticDocument: '{"code":"TRANSPORT_UNCERTAIN","truncated":false}',
    });
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(10000);
    const view = await coordinator.view();
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(view.run?.state).toBe('error');
    expect(view.run?.progress).toMatchObject({ classified: 0, rejected: 0, uncertain: 1 });
    await expect(coordinator.command(await order(coordinator, 'resume'))).rejects.toThrow(
      ReplayConflict,
    );
  });
  it('fallo al guardar resultado bloquea controles y despachos, conservando el intento sin clasificación', async () => {
    const { coordinator, producer, journal, current } = setup();
    vi.mocked(journal.resolveAttempt).mockRejectedValueOnce(new Error('synthetic-journal-loss'));
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(10000);
    vi.mocked(journal.confirmIntention).mockRejectedValueOnce(
      new Error('synthetic-read-unavailable'),
    );
    await expect(coordinator.view()).rejects.toThrow(ReplayAdmissionUnknown);
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(current().progress).toMatchObject({ classified: 0, inFlight: 1 });
    vi.mocked(journal.confirmIntention).mockResolvedValueOnce({
      state: 'applied',
      snapshot: current(),
    });
    const recovered = await coordinator.view();
    expect(recovered.run).toMatchObject({
      state: 'error',
      verification: 'inconclusive',
      progress: { classified: 0, inFlight: 0, uncertain: 1 },
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('COMMIT de resultado confirmado después conserva la clasificación original pero detiene el recorrido', async () => {
    const { coordinator, journal, producer, current } = setup();
    const normal = vi.mocked(journal.resolveAttempt).getMockImplementation()!;
    vi.mocked(journal.resolveAttempt).mockImplementationOnce(async (...args) => {
      await normal(...args);
      throw new Error('synthetic-lost-result-commit');
    });
    await start(coordinator);
    vi.mocked(journal.confirmIntention).mockResolvedValueOnce({
      state: 'applied',
      snapshot: current(),
    });
    const recovered = await coordinator.view();
    expect(recovered.run).toMatchObject({
      state: 'error',
      verification: 'inconclusive',
      progress: { accepted: 1, classified: 1, uncertain: 0 },
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('si se pierde COMMIT del cierre recuperado, releer conserva el mismo informe sin reescribirlo', async () => {
    const { coordinator, journal, current } = setup();
    vi.mocked(journal.resolveAttempt).mockRejectedValueOnce(new Error('synthetic-initial-failure'));
    await start(coordinator);
    vi.mocked(journal.confirmIntention).mockImplementation(async () => ({
      state: 'applied',
      snapshot: current(),
    }));
    const normal = vi.mocked(journal.resolveAttempt).getMockImplementation()!;
    vi.mocked(journal.resolveAttempt).mockImplementationOnce(async (...args) => {
      await normal(...args);
      throw new Error('synthetic-lost-recovery-close');
    });
    await expect(coordinator.view()).rejects.toThrow(ReplayAdmissionUnknown);
    const saved = current().run.verificationDocument;
    const attempts = vi.mocked(journal.resolveAttempt).mock.calls.length;
    expect((await coordinator.view()).run?.verification).toBe('inconclusive');
    expect(current().run.verificationDocument).toBe(saved);
    expect(vi.mocked(journal.resolveAttempt).mock.calls).toHaveLength(attempts);
  });
  it('pausa en línea24 completada conserva completed, sin inventar una pausa con trabajo restante', async () => {
    const { coordinator, producer, verifier, journal } = setup();
    verifier.evaluate.mockResolvedValue({
      ...report(),
      phase: 'first',
      result: 'inconclusive',
      checks: [{ ...report().checks[0]!, state: 'unavailable' }],
    });
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(22 * 750);
    expect(producer.send).toHaveBeenCalledTimes(23);
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(750);
    const pause = await order(coordinator, 'pause');
    await coordinator.command(pause);
    respond(accepted);
    await vi.advanceTimersByTimeAsync(0);
    const view = await coordinator.view();
    expect(view.run).toMatchObject({
      state: 'completed',
      nextLine: 25,
      progress: { classified: 24 },
    });
    expect(coordinator.admissions.receipts.get(pause.commandId)?.resolution).toBe('completed');
    expect(
      vi.mocked(journal.transition).mock.calls.some((call) => call[2].state === 'paused'),
    ).toBe(false);
  });
  it('un observador fallido no impide el motor ni invalida una confirmación durable', async () => {
    const { coordinator, producer } = setup(() => {
      throw new Error('synthetic-observer-failure');
    });
    await start(coordinator);
    expect((await coordinator.view()).run?.state).toBe('running');
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('respuesta HTTP recibida durante commit incierto se retiene hasta confirmar la intención', async () => {
    const { coordinator, producer, journal, current } = setup();
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await start(coordinator);
    const normal = vi.mocked(journal.transition).getMockImplementation()!;
    vi.mocked(journal.transition).mockImplementationOnce(async (...args) => {
      await normal(...args);
      throw new Error('synthetic-lost-pause-commit');
    });
    vi.mocked(journal.confirmIntention).mockResolvedValueOnce({ state: 'unknown', snapshot: null });
    const pause = await order(coordinator, 'pause');
    await expect(coordinator.command(pause)).rejects.toThrow(ReplayAdmissionUnknown);
    respond(accepted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(journal.resolveAttempt).not.toHaveBeenCalled();
    expect(coordinator.admissions.blocked).toBe(true);
    expect(producer.send).toHaveBeenCalledTimes(1);
    vi.mocked(journal.confirmIntention).mockResolvedValueOnce({
      state: 'applied',
      snapshot: current(),
    });
    await coordinator.view();
    await vi.advanceTimersByTimeAsync(0);
    expect((await coordinator.view()).run).toMatchObject({
      state: 'paused',
      progress: { accepted: 1, inFlight: 0 },
    });
    expect(coordinator.admissions.receipts.get(pause.commandId)?.resolution).toBe('completed');
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('otra instancia recupera una pausa como interrumpida y no reanuda ni envía al arrancar', async () => {
    const { coordinator, journal, verifier } = setup();
    await start(coordinator);
    await coordinator.command(await order(coordinator, 'pause'));
    await vi.advanceTimersByTimeAsync(0);
    expect((await coordinator.view()).run?.state).toBe('paused');
    coordinator.close();
    const nextProducer = { send: vi.fn<SendReplayLine['send']>().mockResolvedValue(accepted) };
    const next = new ReplayCoordinator(
      journal,
      fixture,
      nextProducer,
      verifier,
      new DatabaseSlots(1, 15),
    );
    all.push(next);
    await next.initialize();
    await vi.advanceTimersByTimeAsync(5000);
    expect(nextProducer.send).not.toHaveBeenCalled();
    expect((await next.view()).run).toMatchObject({
      state: 'interrupted',
      verification: 'inconclusive',
    });
    expect((await next.view()).allowedActions).not.toContain('resume');
  });
  it('reinicio parcial espera HTTP, conserva el cierre anterior y comienza otro recorrido exploratorio', async () => {
    const { coordinator, producer, journal } = setup();
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await start(coordinator);
    const first = (await coordinator.view()).run!.runId;
    const restart = await order(coordinator, 'restart', 300);
    const admission = await coordinator.command(restart);
    await vi.advanceTimersByTimeAsync(5000);
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect((await coordinator.view()).run?.state).toBe('restarting');
    respond(accepted);
    await vi.advanceTimersByTimeAsync(0);
    const next = await coordinator.view();
    expect((await journal.find(first))?.run).toMatchObject({
      state: 'stopped',
      verification: 'inconclusive',
    });
    expect(next.run).toMatchObject({ stage: 'exploratory', state: 'running', intervalMs: 300 });
    expect(next.run?.runId).not.toBe(first);
    expect(producer.send.mock.calls[1]![0]).toEqual(fixture.rows[0]);
    expect(producer.send.mock.calls[1]![1]).not.toBe(producer.send.mock.calls[0]![1]);
    const receipt = coordinator.admissions.receipts.get(restart.commandId)!;
    expect(receipt.admission).toBe(admission);
    expect(receipt.resolution).toBe('completed');
  });
  it('un primero completado y verificado exige preparación de segundo antes y después de crearlo', async () => {
    const { coordinator, producer, verifier } = setup();
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(23 * 750);
    const first = (await coordinator.view()).run!;
    expect(first).toMatchObject({ state: 'completed', verification: 'conformant' });
    await coordinator.command(await order(coordinator, 'restart', 100));
    await vi.advanceTimersByTimeAsync(0);
    const second = (await coordinator.view()).run!;
    expect(second).toMatchObject({ stage: 'second', state: 'running' });
    expect(verifier.prepareSecond.mock.calls).toEqual([[first.runId], [first.runId, second.runId]]);
    expect(producer.send.mock.calls[24]![0]).toEqual(fixture.rows[0]);
    await vi.advanceTimersByTimeAsync(23 * 100);
    expect((await coordinator.view()).run?.state).toBe('completed');
    await coordinator.command(await order(coordinator, 'restart'));
    await vi.advanceTimersByTimeAsync(0);
    expect((await coordinator.view()).run?.stage).toBe('exploratory');
  });
  it('un primero conforme con contexto/precondición alterados no crea la segunda ejecución', async () => {
    const { coordinator, producer, journal, verifier } = setup();
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(23 * 750);
    verifier.prepareSecond.mockResolvedValueOnce({ ...report(), result: 'non_conformant' });
    await expect(coordinator.command(await order(coordinator, 'restart'))).rejects.toThrow(
      ReplayPreconditionsFailed,
    );
    expect(journal.create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(producer.send).toHaveBeenCalledTimes(24);
  });
  it('perder COMMIT de la nueva creación detiene el reinicio y confirma su UUID antes de recuperarlo', async () => {
    const { coordinator, producer, journal, current } = setup();
    await start(coordinator);
    const normal = vi.mocked(journal.create).getMockImplementation()!;
    vi.mocked(journal.create).mockImplementationOnce(async (input) => {
      await normal(input);
      throw new Error('synthetic-lost-followup-create');
    });
    const restart = await order(coordinator, 'restart');
    await coordinator.command(restart);
    await vi.advanceTimersByTimeAsync(0);
    expect(current().run.state).toBe('preparing');
    expect(producer.send).toHaveBeenCalledTimes(1);
    vi.mocked(journal.confirmIntention).mockImplementation(async (id) => ({
      state: 'applied',
      snapshot: (await journal.find(id)) ?? null,
    }));
    const recovered = await coordinator.view();
    expect(recovered.run).toMatchObject({
      state: 'error',
      verification: 'inconclusive',
      stage: 'exploratory',
    });
    expect(vi.mocked(journal.confirmIntention).mock.calls[0]!.slice(0, 2)).toEqual([
      recovered.run!.runId,
      null,
    ]);
    expect(coordinator.admissions.receipts.get(restart.commandId)?.resolution).toBe('failed');
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('finalizar espera la petición en curso sin abortarla y cierra el parcial como inconcluso', async () => {
    const { coordinator, producer, journal } = setup();
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await start(coordinator);
    const signal = producer.send.mock.calls[0]![2];
    const finish = await order(coordinator, 'finishVerification');
    await coordinator.command(finish);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await coordinator.view()).toMatchObject({
      pendingAction: 'finishVerification',
      allowedActions: [],
      run: { state: 'finalizing' },
    });
    expect(signal.aborted).toBe(false);
    expect(journal.closeScenario).not.toHaveBeenCalled();
    respond(accepted);
    await vi.advanceTimersByTimeAsync(0);
    expect(await coordinator.view()).toMatchObject({
      pendingAction: null,
      allowedActions: [],
      run: {
        state: 'stopped',
        verification: 'inconclusive',
        closeCode: 'VERIFICATION_CLOSED',
        progress: { accepted: 1, unattempted: 23 },
      },
      scenario: { verification: 'inconclusive', closedAt: expect.any(String) },
    });
    expect(coordinator.admissions.receipts.get(finish.commandId)?.resolution).toBe('completed');
    await vi.advanceTimersByTimeAsync(10000);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('finalizar solo el primero conserva su informe conforme y separa el escenario inconcluso', async () => {
    const { coordinator, journal, current, verifier } = setup();
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(23 * 750);
    const individual = current().run.verificationDocument;
    const runId = current().run.runId;
    await coordinator.command(await order(coordinator, 'finishVerification'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await coordinator.view()).toMatchObject({
      run: { verification: 'conformant' },
      scenario: { verification: 'inconclusive' },
    });
    expect(current().run.verificationDocument).toBe(individual);
    expect(verifier.evaluateScenario).toHaveBeenCalledExactlyOnceWith(runId);
    expect(journal.closeScenario).toHaveBeenCalledTimes(1);
  });
  it('cerrar un par conforme modifica la raíz sin cambiar el segundo actual o sus informes', async () => {
    const { coordinator, journal, current, verifier, producer } = setup();
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(23 * 750);
    const firstId = current().run.runId;
    const firstDocument = current().run.verificationDocument;
    await coordinator.command(await order(coordinator, 'restart', 100));
    await vi.advanceTimersByTimeAsync(23 * 100);
    const secondId = current().run.runId;
    const secondDocument = current().run.verificationDocument;
    verifier.evaluateScenario.mockResolvedValueOnce({
      ...report(),
      result: 'conformant',
      phase: 'second',
    });
    const finish = await order(coordinator, 'finishVerification');
    await coordinator.command(finish);
    await vi.advanceTimersByTimeAsync(0);
    expect(await coordinator.view()).toMatchObject({
      run: { runId: secondId, stage: 'second', verification: 'conformant' },
      scenario: { scenarioId: firstId, verification: 'conformant' },
      allowedActions: [],
    });
    expect((await journal.find(firstId))?.run.verificationDocument).toBe(firstDocument);
    expect(current().run.verificationDocument).toBe(secondDocument);
    expect(journal.closeScenario).toHaveBeenCalledExactlyOnceWith(
      firstId,
      expect.any(Number),
      'conformant',
      expect.any(String),
    );
    expect(coordinator.admissions.receipts.get(finish.commandId)?.resolution).toBe('completed');
    expect(producer.send).toHaveBeenCalledTimes(48);
  });
  it('finalizar con la última línea pendiente completa y verifica antes de cerrar el escenario', async () => {
    const { coordinator, producer, verifier, current } = setup();
    await start(coordinator);
    await vi.advanceTimersByTimeAsync(22 * 750);
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await vi.advanceTimersByTimeAsync(750);
    await coordinator.command(await order(coordinator, 'finishVerification'));
    expect(verifier.evaluate).not.toHaveBeenCalled();
    respond(accepted);
    await vi.advanceTimersByTimeAsync(0);
    expect(await coordinator.view()).toMatchObject({
      run: { state: 'completed', verification: 'conformant', nextLine: 25 },
      scenario: { verification: 'inconclusive' },
    });
    expect(verifier.evaluate).toHaveBeenCalledExactlyOnceWith(current().run.runId);
    expect(verifier.evaluateScenario).toHaveBeenCalledExactlyOnceWith(current().run.runId);
    expect(producer.send).toHaveBeenCalledTimes(24);
  });
  it('finalizar no convierte un envío incierto en rechazo ni cancela su posible procesamiento', async () => {
    const { coordinator, producer } = setup();
    let respond!: (value: ReplayDelivery) => void;
    producer.send.mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    await start(coordinator);
    await coordinator.command(await order(coordinator, 'finishVerification'));
    respond({
      state: 'uncertain',
      closeCode: 'TRANSPORT_UNCERTAIN',
      httpStatus: null,
      diagnosticDocument: '{"code":"TRANSPORT_UNCERTAIN","truncated":false}',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await coordinator.view()).toMatchObject({
      run: {
        state: 'error',
        verification: 'inconclusive',
        progress: { uncertain: 1, rejected: 0, classified: 0 },
      },
      scenario: { verification: 'inconclusive' },
    });
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
  it('perder la confirmación de cierre aplicado se resuelve por barrera y documento sin reescribirlo', async () => {
    const { coordinator, journal, current } = setup();
    await start(coordinator);
    await coordinator.command(await order(coordinator, 'pause'));
    await vi.advanceTimersByTimeAsync(0);
    const normal = vi.mocked(journal.closeScenario).getMockImplementation()!;
    vi.mocked(journal.closeScenario).mockImplementationOnce(async (...args) => {
      await normal(...args);
      throw new Error('synthetic-lost-scenario-commit');
    });
    const finish = await order(coordinator, 'finishVerification');
    await coordinator.command(finish);
    await vi.advanceTimersByTimeAsync(0);
    const document = current().run.scenarioDocument;
    vi.mocked(journal.confirmIntention).mockResolvedValueOnce({
      state: 'applied',
      snapshot: current(),
    });
    expect(await coordinator.view()).toMatchObject({
      blockedReason: null,
      scenario: { verification: 'inconclusive' },
      pendingAction: null,
    });
    expect(current().run.scenarioDocument).toBe(document);
    expect(journal.closeScenario).toHaveBeenCalledTimes(1);
    expect(coordinator.admissions.receipts.get(finish.commandId)?.resolution).toBe('completed');
  });
  it('cierre no aplicado falla la orden, conserva escenario pendiente y requiere una intención nueva', async () => {
    const { coordinator, journal, current, producer } = setup();
    await start(coordinator);
    await coordinator.command(await order(coordinator, 'pause'));
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(journal.closeScenario).mockRejectedValueOnce(new Error('synthetic-close-rollback'));
    const finish = await order(coordinator, 'finishVerification');
    await coordinator.command(finish);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(journal.confirmIntention).mockResolvedValueOnce({
      state: 'applied',
      snapshot: current(),
    });
    expect(await coordinator.view()).toMatchObject({
      blockedReason: null,
      scenario: { verification: 'pending' },
      pendingAction: null,
      allowedActions: ['restart', 'finishVerification'],
    });
    expect(coordinator.admissions.receipts.get(finish.commandId)).toMatchObject({
      resolution: 'failed',
      reasonCode: 'JOURNAL_UNCERTAIN',
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(journal.closeScenario).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledTimes(1);
    await coordinator.command(await order(coordinator, 'finishVerification'));
    await vi.advanceTimersByTimeAsync(0);
    expect((await coordinator.view()).scenario?.verification).toBe('inconclusive');
  });
  it('un cierre cuyo resultado no puede consultarse permanece bloqueado sin reescritura o envíos', async () => {
    const { coordinator, journal, producer } = setup();
    await start(coordinator);
    await coordinator.command(await order(coordinator, 'pause'));
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(journal.closeScenario).mockRejectedValueOnce(new Error('synthetic-close-unknown'));
    const finish = await order(coordinator, 'finishVerification');
    await coordinator.command(finish);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(journal.confirmIntention).mockRejectedValue(new Error('synthetic-read-unavailable'));
    await expect(coordinator.view()).rejects.toThrow(ReplayAdmissionUnknown);
    expect(coordinator.admissions.receipts.get(finish.commandId)?.resolution).toBe('pending');
    await vi.advanceTimersByTimeAsync(10000);
    expect(journal.closeScenario).toHaveBeenCalledTimes(1);
    expect(producer.send).toHaveBeenCalledTimes(1);
  });
});
