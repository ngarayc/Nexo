import { randomUUID } from 'node:crypto';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { ingestionQueue } from '../../../../platform/queue/policy.js';
import {
  ClassifyTelemetry,
  TelemetryTransaction,
  OriginalJson,
} from '../../../telemetry/public.js';
import { readWork } from '../../domain/work.js';

type BatchRow = { state: string; next_index: number; total: number };
type ItemRow = {
  state: string;
  generation: number;
  job_id: string;
  due: boolean;
  input_document: string;
};

export class ProcessItem {
  private readonly db;
  private readonly classify = new ClassifyTelemetry();
  constructor(
    pool: Pool,
    private readonly boss: PgBoss,
  ) {
    this.db = drizzle(pool);
  }

  async execute(
    jobId: string,
    data: unknown,
    signal: AbortSignal,
  ): Promise<'classified' | 'obsolete'> {
    const work = readWork(data);
    if (!work) return 'obsolete';
    signal.throwIfAborted();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL transaction_timeout='10s'`);
      // Orden único de bloqueos para consumidor y futuro reconciliador: lote, posición.
      const parent = await tx.execute<BatchRow>(sql`
        SELECT state,next_index,total FROM ingestion_batches
        WHERE ingestion_id=${work.ingestionId} FOR UPDATE`);
      const batch = parent.rows[0];
      if (!batch || batch.state !== 'active' || batch.next_index !== work.index) return 'obsolete';
      const result = await tx.execute<ItemRow>(sql`
        SELECT state,generation,job_id,not_before<=clock_timestamp() AS due,input_document::text
        FROM ingestion_items WHERE ingestion_id=${work.ingestionId} AND item_index=${work.index}
        FOR UPDATE`);
      const item = result.rows[0];
      if (
        !item ||
        item.state !== 'scheduled' ||
        item.generation !== work.generation ||
        item.job_id !== jobId ||
        !item.due
      )
        return 'obsolete';
      signal.throwIfAborted();
      const classified = await this.classify.execute(
        OriginalJson.parse(item.input_document),
        new TelemetryTransaction(tx),
      );
      const eventPk = classified.outcome === 'rejected' ? null : classified.eventPk.toString();
      const reason = classified.outcome === 'rejected' ? classified.reason : null;
      await tx.execute(sql`
        UPDATE ingestion_items SET state='classified',outcome=${classified.outcome},
          reason_code=${reason},resolved_event_pk=${eventPk},finalized_at=clock_timestamp()
        WHERE ingestion_id=${work.ingestionId} AND item_index=${work.index}`);
      const next = work.index + 1;
      if (next < batch.total) {
        const jobId = randomUUID();
        const updated = await tx.execute(sql`
          UPDATE ingestion_items SET state='scheduled',generation=1,opportunities_reserved=1,
            job_id=${jobId},not_before=clock_timestamp()
          WHERE ingestion_id=${work.ingestionId} AND item_index=${next} AND state='waiting'
          RETURNING item_index`);
        if (updated.rows.length !== 1) throw new Error('Continuación durable incoherente.');
        const sent = await this.boss.send(
          ingestionQueue,
          { ingestionId: work.ingestionId, index: next, generation: 1 },
          { id: jobId, retryLimit: 0, db: fromDrizzle(tx, sql) },
        );
        if (sent !== jobId) throw new Error('No se confirmó la continuación reservada.');
      }
      await tx.execute(sql`
        UPDATE ingestion_batches SET state=${next === batch.total ? 'complete' : 'active'},
          next_index=${next},revision=revision+1,updated_at=clock_timestamp()
        WHERE ingestion_id=${work.ingestionId}`);
      signal.throwIfAborted();
      return 'classified';
    });
    // La resolución implica COMMIT confirmado; pg-boss hace ACK después del retorno.
  }
}
