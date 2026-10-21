import { randomUUID } from 'node:crypto';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { ingestionBatches, ingestionItems } from '../../../../platform/database/schema.js';
import { DatabaseSlots, DatabaseCapacityError } from '../../../../platform/database/slots.js';
import { WriteTransactions } from '../../../../platform/database/write-transactions.js';
import { ingestionQueue } from '../../../../platform/queue/policy.js';
import { OriginalJson } from '../../../telemetry/public.js';
import type { BatchInput } from '../../domain/batch.js';
import { IngestionIdConflict, IngestionCapacityError } from '../../application/ingest.js';
export { IngestionIdConflict, IngestionCapacityError } from '../../application/ingest.js';

type Capacity = {
  active: string;
  pending: string;
  active_bytes: string;
  retained: string;
  retained_bytes: string;
};

export class AdmissionStore {
  private readonly db;
  private readonly slots = new DatabaseSlots(1, 15);

  constructor(
    writePool: Pool,
    private readonly readPool: Pool,
    private readonly boss: PgBoss,
    private readonly readSlots: DatabaseSlots,
  ) {
    this.db = new WriteTransactions(writePool);
  }

  async admit(ingestionId: string, batch: BatchInput): Promise<'created' | 'existing'> {
    try {
      return await this.admitChecked(ingestionId, batch);
    } catch (error) {
      if (error instanceof DatabaseCapacityError) throw new IngestionCapacityError();
      throw error;
    }
  }

  private async admitChecked(
    ingestionId: string,
    batch: BatchInput,
  ): Promise<'created' | 'existing'> {
    const seen = await this.readSlots.run(() =>
      this.readPool.query<{ request_document: string }>(
        'SELECT request_document::text FROM ingestion_batches WHERE ingestion_id=$1',
        [ingestionId],
      ),
    );
    const previous = seen.rows[0];
    if (previous) {
      if (!OriginalJson.parse(previous.request_document).equals(batch.document))
        throw new IngestionIdConflict();
      return 'existing';
    }
    return this.slots.run(() =>
      this.db.run(async (tx) => {
        // Solo altas nuevas; no participa en procesadores, consultas o replay.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(72416002)`);
        // Nueva sentencia después de adquirir el bloqueo: observa admisiones previas.
        const existing = await tx.execute<{ request_document: string }>(
          sql`SELECT request_document::text FROM ingestion_batches WHERE ingestion_id=${ingestionId}`,
        );
        const previous = existing.rows[0];
        if (previous) {
          if (!OriginalJson.parse(previous.request_document).equals(batch.document))
            throw new IngestionIdConflict();
          return 'existing';
        }
        const result = await tx.execute<Capacity>(sql`SELECT
        count(*) FILTER (WHERE state='active')::text AS active,
        coalesce(sum(total-next_index) FILTER (WHERE state='active'),0)::text AS pending,
        coalesce(sum(input_bytes) FILTER (WHERE state='active'),0)::text AS active_bytes,
        coalesce(sum(total),0)::text AS retained,
        coalesce(sum(input_bytes),0)::text AS retained_bytes
        FROM ingestion_batches`);
        const capacity = result.rows[0]!;
        const total = batch.items.length;
        if (
          BigInt(capacity.active) + 1n > 64n ||
          BigInt(capacity.pending) + BigInt(total) > 20000n ||
          BigInt(capacity.active_bytes) + batch.inputBytes > 64n * 1024n * 1024n ||
          BigInt(capacity.retained) + BigInt(total) > 200000n ||
          BigInt(capacity.retained_bytes) + batch.inputBytes > 512n * 1024n * 1024n
        )
          throw new IngestionCapacityError();
        await tx.insert(ingestionBatches).values({
          ingestionId,
          requestDocument: batch.document.raw,
          total,
          inputBytes: batch.inputBytes,
        });
        const jobId = randomUUID();
        await tx.insert(ingestionItems).values(
          batch.items.map((input, index) =>
            index === 0
              ? {
                  ingestionId,
                  itemIndex: index,
                  inputDocument: input.raw,
                  state: 'scheduled',
                  generation: 1,
                  opportunitiesReserved: 1,
                  jobId,
                  notBefore: sql`now()`,
                }
              : { ingestionId, itemIndex: index, inputDocument: input.raw },
          ),
        );
        const sent = await this.boss.send(
          ingestionQueue,
          { ingestionId, index: 0, generation: 1 },
          { id: jobId, retryLimit: 0, db: fromDrizzle(tx, sql) },
        );
        if (sent !== jobId) throw new Error('La publicación no confirmó el job reservado.');
        return 'created';
      }),
    );
  }
}
