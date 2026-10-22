import { ReplayCommandReceipts } from './command-receipts.js';
import type { ReplayCommandReceipt } from './command-receipts.js';
import type {
  NewReplayRun,
  ReplayIntention,
  ReplayJournal,
  ReplaySnapshot,
  ReplayTransition,
  IntentionConfirmation,
} from './journal.js';
import {
  readReplayCommand,
  readReplayUuid,
  replayCommandDocument,
  sameReplayCommand,
} from '../domain/command.js';
import type { ReplayCommand } from '../domain/command.js';
import { ReplayConflict, ReplayCapacity, ReplayInputError } from '../domain/replay.js';

export class ReplayAdmissionUnknown extends Error {
  constructor() {
    super('La admisión de la orden todavía no se puede determinar.');
  }
}
export class ReplayAdmissionNotApplied extends Error {
  constructor() {
    super('La orden no se aplicó; recupera el estado antes de otra intención.');
  }
}
export type CommandAdmission =
  | { readonly state: 'existing'; readonly receipt: ReplayCommandReceipt }
  | {
      readonly state: 'admitted';
      readonly receipt: ReplayCommandReceipt;
      readonly snapshot: ReplaySnapshot;
    };
interface Pending {
  readonly command: ReplayCommand;
  readonly runId: string;
  readonly previousRevision: number | null;
  readonly intention: ReplayIntention;
}

// El coordinador llama estos métodos dentro de su sección corta y no escribe
// otro resultado/marcador mientras blocked sea true. Nunca envía HTTP ni repite
// una mutación incierta: únicamente consulta su marcador tras la barrera SQL.
export class AdmitReplayCommand {
  private pending: Pending | undefined;
  readonly instanceId: string;
  constructor(
    private readonly journal: ReplayJournal,
    readonly receipts: ReplayCommandReceipts,
    instanceId: string,
  ) {
    this.instanceId = readReplayUuid(instanceId);
  }
  get blocked(): boolean {
    return this.pending !== undefined;
  }
  get pendingCommandId(): string | null {
    return this.pending?.command.commandId ?? null;
  }
  async create(command: ReplayCommand, proposal: NewReplayRun): Promise<CommandAdmission> {
    const input = readReplayCommand(command);
    if (input.action !== 'start' && input.action !== 'restart') throw new ReplayConflict();
    if (proposal.instanceId !== this.instanceId) throw new ReplayConflict();
    return this.admit(input, proposal.runId, null, (intention) =>
      this.journal.create({ ...proposal, intention }),
    );
  }
  async transition(
    command: ReplayCommand,
    previousRevision: number,
    change: ReplayTransition,
  ): Promise<CommandAdmission> {
    const input = readReplayCommand(command);
    if (input.runId === null || input.action === 'start') throw new ReplayConflict();
    return this.admit(input, input.runId, previousRevision, (intention) =>
      this.journal.transition(input.runId!, previousRevision, { ...change, intention }),
    );
  }
  private async admit(
    command: ReplayCommand,
    runId: string,
    previousRevision: number | null,
    operation: (intention: ReplayIntention) => Promise<ReplaySnapshot>,
  ): Promise<CommandAdmission> {
    if (command.instanceId !== this.instanceId) throw new ReplayConflict();
    const existing = this.receipts.find(command);
    if (existing) return { state: 'existing', receipt: existing };
    if (this.pending) {
      if (this.pending.command.commandId !== command.commandId) throw new ReplayAdmissionUnknown();
      sameReplayCommand(this.pending.intention.document, command);
      return this.confirm();
    }
    if (command.expectedControlVersion >= Number.MAX_SAFE_INTEGER) throw new ReplayCapacity();
    readReplayUuid(runId);
    this.receipts.ensureCapacity();
    this.pending = {
      command,
      runId,
      previousRevision,
      intention: {
        commandId: command.commandId,
        instanceId: this.instanceId,
        expectedControlVersion: command.expectedControlVersion,
        document: replayCommandDocument(command),
      },
    };
    let snapshot: ReplaySnapshot;
    try {
      snapshot = await operation(this.pending.intention);
    } catch (error) {
      try {
        return await this.confirm();
      } catch (confirmationError) {
        if (
          confirmationError instanceof ReplayAdmissionNotApplied &&
          (error instanceof ReplayConflict ||
            error instanceof ReplayCapacity ||
            error instanceof ReplayInputError)
        )
          throw error;
        throw confirmationError;
      }
    }
    return this.accept(snapshot);
  }
  async confirm(): Promise<CommandAdmission> {
    const pending = this.pending;
    if (!pending) throw new ReplayConflict();
    let result: IntentionConfirmation;
    try {
      result = await this.journal.confirmIntention(
        pending.runId,
        pending.previousRevision,
        pending.intention,
      );
    } catch {
      throw new ReplayAdmissionUnknown();
    }
    if (result.state === 'not_applied') {
      this.pending = undefined;
      throw new ReplayAdmissionNotApplied();
    }
    if (result.state !== 'applied' || result.snapshot === null) throw new ReplayAdmissionUnknown();
    return this.accept(result.snapshot);
  }
  private accept(snapshot: ReplaySnapshot): CommandAdmission {
    const pending = this.pending;
    if (!pending || snapshot.run.runId !== pending.runId) throw new ReplayAdmissionUnknown();
    this.receipts.record(
      pending.command,
      pending.runId,
      pending.command.expectedControlVersion + 1,
    );
    this.pending = undefined;
    return {
      state: 'admitted',
      receipt: this.receipts.get(pending.command.commandId)!,
      snapshot,
    };
  }
}
