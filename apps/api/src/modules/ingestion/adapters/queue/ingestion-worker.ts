import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { QueueConnection } from '../../../../platform/queue/connection.js';
import { ingestionQueue } from '../../../../platform/queue/policy.js';
import { ProcessItem } from '../postgres/process-item.js';

@Injectable()
export class IngestionWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: QueueConnection,
    private readonly processor: ProcessItem,
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
        if (!job) throw new Error('INGESTION_WORK_UNCONFIRMED');
        try {
          await this.processor.execute(job.id, job.data, job.signal);
        } catch {
          // El estado propio se relee para recuperación; no filtrar SQL/payload al job.
          throw new Error('INGESTION_WORK_UNCONFIRMED');
        }
      },
    );
  }
}
