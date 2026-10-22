import { randomInt, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { DatabaseSlots } from '../../../../platform/database/slots.js';
import { WriteTransactions } from '../../../../platform/database/write-transactions.js';
import { ingestionQueue } from '../../../../platform/queue/policy.js';
import { readWork } from '../../domain/work.js';
import {
  isRecoverable,
  recoveryWindow,
  IngestionInvariantError,
} from '../../domain/recovery-policy.js';
import type { TechnicalCode } from '../../domain/recovery-policy.js';
import type {
  InspectionCursor,
  InspectionCandidate,
  RecoveryResult,
} from '../../application/reconcile.js';

type BatchRow = { state: string; next_index: number; total: number };
type ItemRow = {
  state: string;
  generation: number;
  job_id: string;
  opportunities_reserved: number;
  attempt_limit: number;
  policy_version: number;
};
type CandidateRow = {
  ingestion_id: string;
  received_at: string;
  next_index: number;
  generation: number | null;
  job_id: string | null;
};

export class RecoverItem {
  private readonly writes;
  private readonly reads;
  constructor(
    pool: Pool,
    private readonly boss: PgBoss,
    private readonly control = new DatabaseSlots(1, 0),
  ) {
    this.writes = new WriteTransactions(pool);
    this.reads = drizzle(pool);
  }

  async page(cursor: InspectionCursor | undefined): Promise<readonly InspectionCandidate[]> {
    return this.control.run(async () => {
      const after = cursor
        ? sql`(b.received_at,b.ingestion_id)>(${cursor.receivedAt}::timestamptz,${cursor.ingestionId}::uuid)`
        : sql`TRUE`;
      const result = await this.reads.execute<CandidateRow>(sql`
        SELECT b.ingestion_id,b.received_at::text,b.next_index,i.generation,i.job_id
        FROM ingestion_batches b LEFT JOIN ingestion_items i
          ON i.ingestion_id=b.ingestion_id AND i.item_index=b.next_index
        WHERE b.state='active' AND ${after}
        ORDER BY b.received_at,b.ingestion_id LIMIT 20`);
      return result.rows.map((row) => ({
        cursor: { receivedAt: row.received_at, ingestionId: row.ingestion_id },
        work: readWork({
          ingestionId: row.ingestion_id,
          index: row.next_index,
          generation: row.generation,
        }),
        jobId: row.job_id,
      }));
    });
  }

  async recover(jobId: string, data: unknown, failure?: TechnicalCode): Promise<RecoveryResult> {
    const work = readWork(data);
    if (!work) return 'obsolete';
    return this.control.run(() =>
      this.writes.run(async (tx) => {
        const parent = await tx.execute<BatchRow>(sql`
        SELECT state,next_index,total FROM ingestion_batches
        WHERE ingestion_id=${work.ingestionId} FOR UPDATE SKIP LOCKED`);
        const batch = parent.rows[0];
        if (!batch) return 'skipped';
        if (batch.state !== 'active' || batch.next_index !== work.index) return 'obsolete';
        const result = await tx.execute<ItemRow>(sql`
        SELECT state,generation,job_id,opportunities_reserved,attempt_limit,policy_version
        FROM ingestion_items WHERE ingestion_id=${work.ingestionId} AND item_index=${work.index}
        FOR UPDATE SKIP LOCKED`);
        const item = result.rows[0];
        if (!item) return 'skipped';
        if (
          item.state !== 'scheduled' ||
          item.generation !== work.generation ||
          item.job_id !== jobId
        )
          return 'obsolete';
        let code = failure;
        if (item.policy_version !== 1 || item.attempt_limit !== 3) code = 'SCHEMA_INCOMPATIBLE';
        if (!code) {
          // Sin queued:true: ausencia solo después de consultar todos los estados.
          const jobs = await this.boss.findJobs(ingestionQueue, {
            id: jobId,
            limit: 1,
            queued: false,
            db: fromDrizzle(tx, sql),
          });
          const job = jobs[0];
          if (!job) code = 'JOB_MISSING';
          else {
            const observed = readWork(job.data);
            if (
              job.id !== jobId ||
              !observed ||
              observed.ingestionId !== work.ingestionId ||
              observed.index !== work.index ||
              observed.generation !== work.generation
            )
              code = 'QUEUE_PROTOCOL_VIOLATION';
            else if (job.state === 'created' || job.state === 'retry' || job.state === 'active')
              return 'waiting';
            else if (job.state === 'failed') code = 'JOB_FAILED';
            else if (job.state === 'cancelled') code = 'QUEUE_CANCELLED';
            else code = 'QUEUE_PROTOCOL_VIOLATION';
          }
        }
        if (!isRecoverable(code) || item.opportunities_reserved >= item.attempt_limit) {
          await tx.execute(sql`
          UPDATE ingestion_items SET state='failed',failure_code=${code},
            last_failure_generation=generation,last_failure_at=clock_timestamp(),finalized_at=clock_timestamp()
          WHERE ingestion_id=${work.ingestionId} AND item_index=${work.index}`);
          const blocked = await tx.execute(sql`
          UPDATE ingestion_items SET state='blocked',failure_code='BLOCKED_BY_PREVIOUS_FAILURE',
            finalized_at=clock_timestamp()
          WHERE ingestion_id=${work.ingestionId} AND item_index>${work.index} AND state='waiting'
          RETURNING item_index`);
          if (blocked.rows.length !== batch.total - work.index - 1)
            throw new IngestionInvariantError();
          await tx.execute(sql`
          UPDATE ingestion_batches SET state='failed',failed_index=${work.index},failure_code=${code},
            revision=revision+1,updated_at=clock_timestamp() WHERE ingestion_id=${work.ingestionId}`);
          return 'failed';
        }
        const { baseMilliseconds, maximumJitterMilliseconds } = recoveryWindow(item.generation);
        const delay = baseMilliseconds + randomInt(maximumJitterMilliseconds + 1);
        const nextId = randomUUID();
        const scheduled = await tx.execute<{ start_after: string }>(sql`
        UPDATE ingestion_items SET generation=generation+1,opportunities_reserved=opportunities_reserved+1,
          job_id=${nextId},failure_code=${code},last_failure_generation=generation,last_failure_at=clock_timestamp(),
          not_before=GREATEST(not_before,clock_timestamp()+${delay}::integer*interval '1 millisecond')
        WHERE ingestion_id=${work.ingestionId} AND item_index=${work.index}
        RETURNING to_char(not_before AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start_after`);
        const startAfter = scheduled.rows[0]?.start_after;
        if (!startAfter) throw new IngestionInvariantError();
        const sent = await this.boss.send(
          ingestionQueue,
          { ingestionId: work.ingestionId, index: work.index, generation: work.generation + 1 },
          { id: nextId, retryLimit: 0, startAfter, db: fromDrizzle(tx, sql) },
        );
        if (sent !== nextId) throw new IngestionInvariantError();
        await tx.execute(sql`
        UPDATE ingestion_batches SET revision=revision+1,updated_at=clock_timestamp()
        WHERE ingestion_id=${work.ingestionId}`);
        return 'scheduled';
      }),
    );
  }
}
