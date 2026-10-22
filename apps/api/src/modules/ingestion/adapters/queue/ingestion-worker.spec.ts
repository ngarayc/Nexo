import { expect, it, vi } from 'vitest';
import type { WorkHandler, WorkOptions, Job } from 'pg-boss';
import type { QueueConnection } from '../../../../platform/queue/connection.js';
import type { ProcessItem } from '../postgres/process-item.js';
import type { RecoverItem } from '../postgres/recover-item.js';
import { IngestionWorker } from './ingestion-worker.js';
import { CommittedChanges } from '../../../../platform/runtime/runtime.module.js';

async function worker(processResult: Promise<unknown>, recoveryResult: Promise<unknown>) {
  let handler: WorkHandler<unknown> | undefined;
  const work = vi.fn(
    async (_name: string, _options: WorkOptions, consume: WorkHandler<unknown>) => {
      handler = consume;
      return 'worker';
    },
  );
  const process = { execute: vi.fn(() => processResult) };
  const recovery = { recover: vi.fn(() => recoveryResult) };
  const committed = new CommittedChanges();
  const notified = vi.fn();
  committed.subscribe(notified);
  // Registrar rechazos enseguida: el handler los observa después del bootstrap.
  void processResult.catch(() => {});
  void recoveryResult.catch(() => {});
  await new IngestionWorker(
    { boss: { work } } as unknown as QueueConnection,
    process as unknown as ProcessItem,
    recovery as unknown as RecoverItem,
    committed,
  ).onApplicationBootstrap();
  if (!handler) throw new Error('Handler no registrado.');
  const job: Job<unknown> = {
    id: 'a5dd6bd2-355d-4241-a7a8-365439212029',
    name: 'telemetry.ingest',
    data: { ingestionId: 'a5dd6bd2-355d-4241-a7a8-365439212029', index: 0, generation: 1 },
    expireInSeconds: 30,
    heartbeatSeconds: null,
    retryCount: 0,
    signal: new AbortController().signal,
  };
  return { consume: () => handler!([job]), work, process, recovery, job, notified };
}

it('la incertidumbre pasa al recuperador antes de confirmar la responsabilidad del job', async () => {
  const w = await worker(Promise.reject(new Error('REPLY_LOST')), Promise.resolve('obsolete'));
  await expect(w.consume()).resolves.toBeUndefined();
  expect(w.recovery.recover).toHaveBeenCalledExactlyOnceWith(
    w.job.id,
    w.job.data,
    'PROCESSING_UNCONFIRMED',
  );
  expect(w.work.mock.calls[0]?.[1]).toMatchObject({ batchSize: 1, localConcurrency: 4 });
});

it('una recuperación no comprobada no permite ACK ni filtra el error original', async () => {
  for (const recovered of [
    () => Promise.resolve('skipped'),
    () => Promise.reject(new Error('private SQL')),
  ]) {
    const w = await worker(Promise.reject(new Error('private SQL')), recovered());
    await expect(w.consume()).rejects.toThrow(/^INGESTION_WORK_UNCONFIRMED$/);
  }
});

it('el aviso local ocurre después de la clasificación confirmada y no por una oportunidad obsoleta', async () => {
  let confirm!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    confirm = resolve;
  });
  const w = await worker(pending, Promise.resolve('unused'));
  const consumption = w.consume();
  expect(w.notified).not.toHaveBeenCalled();
  confirm('classified');
  await consumption;
  expect(w.notified).toHaveBeenCalledOnce();
  const obsolete = await worker(Promise.resolve('obsolete'), Promise.resolve('unused'));
  await obsolete.consume();
  expect(obsolete.notified).not.toHaveBeenCalled();
});
