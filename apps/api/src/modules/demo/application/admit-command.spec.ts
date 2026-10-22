import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AdmitReplayCommand,
  ReplayAdmissionUnknown,
  ReplayAdmissionNotApplied,
} from './admit-command.js';
import { ReplayCommandReceipts } from './command-receipts.js';
import type {
  ReplayJournal,
  ReplaySnapshot,
  NewReplayRun,
  IntentionConfirmation,
} from './journal.js';
import { readReplayCommand } from '../domain/command.js';
import { ReplayConflict, ReplayCapacity, ReplayInputError } from '../domain/replay.js';

function setup() {
  const instanceId = randomUUID(),
    runId = randomUUID();
  const command = readReplayCommand({
    commandId: randomUUID(),
    instanceId,
    expectedControlVersion: 0,
    runId: null,
    action: 'start',
  });
  const proposal: NewReplayRun = {
    runId,
    scenarioId: runId,
    previousRunId: null,
    instanceId,
    fixtureSha256: 'a'.repeat(64),
    stage: 'first',
    intervalMs: 750,
  };
  // Snapshot mínimo controlado: aquí se prueba la admisión, no las reglas SQL.
  const snapshot = { run: { runId } } as ReplaySnapshot;
  const journal = {
    create: vi.fn<ReplayJournal['create']>().mockResolvedValue(snapshot),
    transition: vi.fn<ReplayJournal['transition']>().mockResolvedValue(snapshot),
    confirmIntention: vi.fn<ReplayJournal['confirmIntention']>(),
  };
  const receipts = new ReplayCommandReceipts();
  const admission = new AdmitReplayCommand(
    journal as unknown as ReplayJournal,
    receipts,
    instanceId,
  );
  return { admission, journal, receipts, command, proposal, snapshot };
}
describe('admisión durable bajo coordinación del motor', () => {
  it('no registra aceptación antes de confirmar la escritura y conserva el marcador normalizado', async () => {
    const { admission, journal, receipts, command, proposal, snapshot } = setup();
    let complete!: (value: ReplaySnapshot) => void;
    journal.create.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const pending = admission.create(command, proposal);
    expect(admission.blocked).toBe(true);
    expect(receipts.get(command.commandId)).toBeUndefined();
    expect(journal.create.mock.calls[0]![0].intention).toMatchObject({
      commandId: command.commandId,
      instanceId: command.instanceId,
      expectedControlVersion: 0,
    });
    complete(snapshot);
    const result = await pending;
    expect(result.state).toBe('admitted');
    expect(result.receipt.admission.accepted).toBe(true);
    expect(result.receipt.admission.admittedControlVersion).toBe(1);
    expect(admission.blocked).toBe(false);
  });
  it('repetir devuelve la admisión conocida sin escribir ni exigir de nuevo la revisión anterior', async () => {
    const { admission, journal, command, proposal } = setup();
    const first = await admission.create(command, proposal);
    expect((await admission.create(command, proposal)).receipt.admission).toBe(
      first.receipt.admission,
    );
    expect(journal.create).toHaveBeenCalledTimes(1);
    await expect(admission.create({ ...command, intervalMs: 100 }, proposal)).rejects.toThrow(
      ReplayConflict,
    );
  });
  it('respuesta COMMIT perdida se confirma por barrera sin repetir la creación', async () => {
    const { admission, journal, command, proposal, snapshot } = setup();
    journal.create.mockRejectedValueOnce(new Error('synthetic-lost-response'));
    journal.confirmIntention.mockResolvedValueOnce({ state: 'applied', snapshot });
    expect((await admission.create(command, proposal)).state).toBe('admitted');
    expect(journal.create).toHaveBeenCalledTimes(1);
    expect(journal.confirmIntention).toHaveBeenCalledWith(
      proposal.runId,
      null,
      expect.objectContaining({ commandId: command.commandId }),
    );
  });
  it.each(['unknown', 'failed'] as const)(
    'confirmación %s bloquea otras órdenes y no fabrica admisión',
    async (state) => {
      const { admission, journal, receipts, command, proposal, snapshot } = setup();
      journal.create.mockRejectedValueOnce(new Error('synthetic-write-loss'));
      if (state === 'unknown')
        journal.confirmIntention.mockResolvedValueOnce({ state, snapshot: null });
      else journal.confirmIntention.mockRejectedValueOnce(new Error('synthetic-read-loss'));
      await expect(admission.create(command, proposal)).rejects.toThrow(ReplayAdmissionUnknown);
      expect(receipts.get(command.commandId)).toBeUndefined();
      expect(admission.pendingCommandId).toBe(command.commandId);
      await expect(
        admission.create({ ...command, commandId: randomUUID() }, proposal),
      ).rejects.toThrow(ReplayAdmissionUnknown);
      await expect(admission.create({ ...command, intervalMs: 100 }, proposal)).rejects.toThrow(
        ReplayConflict,
      );
      journal.confirmIntention.mockResolvedValueOnce({ state: 'applied', snapshot });
      expect((await admission.confirm()).state).toBe('admitted');
      expect(journal.create).toHaveBeenCalledTimes(1);
      expect(admission.blocked).toBe(false);
    },
  );
  it('rollback confirmado queda no aplicado, sin recibo de aceptación', async () => {
    const { admission, journal, receipts, command, proposal } = setup();
    journal.create.mockRejectedValueOnce(new Error('synthetic-write-failure'));
    journal.confirmIntention.mockResolvedValueOnce({ state: 'not_applied', snapshot: null });
    await expect(admission.create(command, proposal)).rejects.toThrow(ReplayAdmissionNotApplied);
    expect(receipts.get(command.commandId)).toBeUndefined();
    expect(admission.blocked).toBe(false);
  });
  it.each([ReplayConflict, ReplayCapacity, ReplayInputError])(
    'rechazo conocido conserva su tipo solo después de comprobar no aplicación',
    async (Failure) => {
      const { admission, journal, command, proposal } = setup();
      journal.create.mockRejectedValueOnce(new Failure());
      journal.confirmIntention.mockResolvedValueOnce({ state: 'not_applied', snapshot: null });
      await expect(admission.create(command, proposal)).rejects.toThrow(Failure);
      expect(journal.confirmIntention).toHaveBeenCalledTimes(1);
    },
  );
  it('una transición confirma usando la revisión previa y no acepta otra instancia', async () => {
    const { admission, journal, command, proposal, snapshot } = setup();
    const pause = readReplayCommand({ ...command, action: 'pause', runId: proposal.runId });
    journal.transition.mockRejectedValueOnce(new Error('synthetic-commit-loss'));
    journal.confirmIntention.mockResolvedValueOnce({
      state: 'applied',
      snapshot,
    } satisfies IntentionConfirmation);
    expect((await admission.transition(pause, 12, { state: 'pausing' })).state).toBe('admitted');
    expect(journal.confirmIntention).toHaveBeenCalledWith(proposal.runId, 12, expect.any(Object));
    await expect(
      admission.create({ ...command, instanceId: randomUUID() }, proposal),
    ).rejects.toThrow(ReplayConflict);
    expect(journal.create).not.toHaveBeenCalled();
  });
});
