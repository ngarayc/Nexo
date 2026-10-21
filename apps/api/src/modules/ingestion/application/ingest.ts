import type { BatchInput } from '../domain/batch.js';
import type { Receipt } from './receipt.js';

export class IngestionIdConflict extends Error {
  constructor() {
    super('El identificador de recepción ya representa otro cuerpo.');
  }
}
export class IngestionCapacityError extends Error {
  constructor() {
    super('Capacidad durable de ingesta agotada.');
  }
}

export interface AdmitBatch {
  admit(ingestionId: string, batch: BatchInput): Promise<'created' | 'existing'>;
}
export interface FindReceipt {
  find(ingestionId: string): Promise<Receipt | undefined>;
}
export type IngestionResult =
  | { readonly state: 'complete' | 'pending' | 'failed'; readonly receipt: Receipt }
  | {
      readonly state: 'unavailable';
      readonly ingestionId: string;
      readonly admission: 'admitted' | 'not_admitted' | 'unknown';
    };

const responseReserveMilliseconds = 8000;
const pollingMilliseconds = 250;

class WaitEnded extends Error {}

function within<T>(operation: Promise<T>, deadline: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', interrupted);
      complete();
    };
    const interrupted = () => finish(() => reject(new WaitEnded()));
    const timer = setTimeout(interrupted, Math.max(0, deadline - Date.now()));
    signal.addEventListener('abort', interrupted, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) interrupted();
    // El plazo cancela la espera, no prueba rollback ni aborta una transacción.
  });
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}

export class Ingest {
  constructor(
    private readonly admission: AdmitBatch,
    private readonly receipts: FindReceipt,
  ) {}

  async execute(
    ingestionId: string,
    batch: BatchInput,
    deadline: number,
    signal: AbortSignal,
  ): Promise<IngestionResult> {
    if (signal.aborted || Date.now() >= deadline - responseReserveMilliseconds) {
      return { state: 'unavailable', ingestionId, admission: 'not_admitted' };
    }
    try {
      await within(
        this.admission.admit(ingestionId, batch),
        deadline - responseReserveMilliseconds,
        signal,
      );
    } catch (error) {
      if (error instanceof IngestionIdConflict || error instanceof IngestionCapacityError)
        throw error;
      // Un error al recibir COMMIT no demuestra rollback; tampoco se reenvía.
      return { state: 'unavailable', ingestionId, admission: 'unknown' };
    }
    try {
      for (;;) {
        if (signal.aborted) return { state: 'unavailable', ingestionId, admission: 'admitted' };
        const receipt = await within(this.receipts.find(ingestionId), deadline - 1000, signal);
        if (!receipt) return { state: 'unavailable', ingestionId, admission: 'admitted' };
        if (receipt.complete) return { state: 'complete', receipt };
        if (receipt.failedIndexes.length > 0) return { state: 'failed', receipt };
        const remaining = deadline - responseReserveMilliseconds - Date.now();
        if (remaining <= 0) return { state: 'pending', receipt };
        await wait(Math.min(pollingMilliseconds, remaining), signal);
      }
    } catch {
      return { state: 'unavailable', ingestionId, admission: 'admitted' };
    }
  }
}
