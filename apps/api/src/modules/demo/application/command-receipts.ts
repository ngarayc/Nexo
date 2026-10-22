import type { ReplayCommand } from '../domain/command.js';
import { replayCommandDocument, sameReplayCommand } from '../domain/command.js';
import { ReplayInvariantError } from '../domain/replay.js';
import type { ReplayFailureCode } from '../domain/replay.js';

export interface ReplayAdmission {
  readonly commandId: string;
  readonly instanceId: string;
  readonly runId: string;
  readonly admittedControlVersion: number;
  readonly accepted: true;
}
export interface ReplayCommandReceipt {
  readonly admission: ReplayAdmission;
  readonly resolution: 'pending' | 'completed' | 'failed';
  readonly reasonCode: ReplayFailureCode | 'PRECONDITIONS_FAILED' | null;
}
export class ReplayControlCapacity extends Error {
  constructor() {
    super('No hay capacidad para conservar otra orden del reproductor.');
  }
}
interface Entry {
  readonly document: string;
  readonly admittedAt: number;
  receipt: ReplayCommandReceipt;
}
// El coordinador serializa ensureCapacity→intención durable→record. No se
// expone admisión antes de confirmar persistencia; su incertidumbre lo bloquea.
export class ReplayCommandReceipts {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  ensureCapacity(): void {
    this.expire();
    if (this.entries.size >= 1024) throw new ReplayControlCapacity();
  }
  find(command: ReplayCommand): ReplayCommandReceipt | undefined {
    const receipt = this.get(command.commandId),
      entry = this.entries.get(command.commandId);
    if (receipt && entry) sameReplayCommand(entry.document, command);
    return receipt;
  }
  get(commandId: string): ReplayCommandReceipt | undefined {
    this.expire();
    return this.entries.get(commandId)?.receipt;
  }
  record(command: ReplayCommand, runId: string, admittedControlVersion: number): ReplayAdmission {
    if (this.find(command)) throw new ReplayInvariantError();
    this.ensureCapacity();
    const admission = Object.freeze({
      commandId: command.commandId,
      instanceId: command.instanceId,
      runId,
      admittedControlVersion,
      accepted: true as const,
    });
    this.entries.set(command.commandId, {
      document: replayCommandDocument(command),
      admittedAt: this.now(),
      receipt: Object.freeze({ admission, resolution: 'pending', reasonCode: null }),
    });
    return admission;
  }
  resolve(commandId: string, reasonCode: ReplayCommandReceipt['reasonCode'] = null): void {
    const entry = this.entries.get(commandId);
    if (!entry || entry.receipt.resolution !== 'pending') throw new ReplayInvariantError();
    entry.receipt = Object.freeze({
      admission: entry.receipt.admission,
      resolution: reasonCode === null ? 'completed' : 'failed',
      reasonCode,
    });
  }
  private expire(): void {
    const now = this.now();
    for (const [id, entry] of this.entries)
      if (entry.receipt.resolution !== 'pending' && now - entry.admittedAt >= 600000)
        this.entries.delete(id);
  }
}
