import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { QueueConnection } from '../../../../platform/queue/connection.js';
import { ingestionQueue } from '../../../../platform/queue/policy.js';
import { ProcessItem } from '../postgres/process-item.js';
import { RecoverItem } from '../postgres/recover-item.js';
import { CommittedChanges } from '../../../../platform/runtime/runtime.module.js';
import {
  processingFailure,
  UnconfirmedIngestionWork,
} from '../../application/processing-failure.js';

@Injectable()
export class IngestionWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: QueueConnection,
    private readonly processor: ProcessItem,
    private readonly recovery: RecoverItem,
    private readonly committedChanges: CommittedChanges,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Bootstrap ocurre después del inicio de QueueConnection, antes de escuchar HTTP.
    await this.queue.boss.work(
      ingestionQueue,
      {
        batchSize: 1,
        localConcurrency: 4,
        pollingIntervalSeconds: 0.5,
        notifyPollingIntervalSeconds: 2,
      },
      async (jobs) => {
        const job = jobs[0];
        if (!job) throw new UnconfirmedIngestionWork();
        try {
          const result = await this.processor.execute(job.id, job.data, job.signal);
          if (result === 'classified') this.committedChanges.notify();
        } catch (error) {
          try {
            const result = await this.recovery.recover(job.id, job.data, processingFailure(error));
            if (result === 'obsolete' || result === 'scheduled' || result === 'failed') return;
          } catch {
            // El reconciliador resolverá incertidumbre/indisponibilidad después.
          }
          throw new UnconfirmedIngestionWork(processingFailure(error));
        }
      },
    );
  }
}
