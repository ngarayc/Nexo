import type { Pool } from 'pg';
import type { DatabaseSlots } from '../../../../platform/database/slots.js';
import { OriginalJson } from '../../../telemetry/public.js';
import type { Receipt, ItemOutcome } from '../../application/receipt.js';

type ReceiptRow = {
  ingestion_id: string;
  revision: string;
  total: number;
  state: string;
  items: {
    index: number;
    input: string;
    state: string;
    outcome: ItemOutcome | null;
    reason: string | null;
    failure: string | null;
  }[];
};

export class ReceiptReader {
  constructor(
    private readonly pool: Pool,
    private readonly slots: DatabaseSlots,
  ) {}

  async find(ingestionId: string): Promise<Receipt | undefined> {
    // Una sentencia: padre y posiciones pertenecen a la misma vista MVCC.
    const result = await this.slots.run(() =>
      this.pool.query<ReceiptRow>(
        `
      SELECT b.ingestion_id,b.revision::text,b.total,b.state,
        coalesce((SELECT json_agg(json_build_object(
          'index',i.item_index,'input',i.input_document::text,'state',i.state,
          'outcome',i.outcome,'reason',i.reason_code,'failure',i.failure_code
        ) ORDER BY i.item_index) FROM ingestion_items i WHERE i.ingestion_id=b.ingestion_id),'[]'::json) AS items
      FROM ingestion_batches b WHERE b.ingestion_id=$1`,
        [ingestionId],
      ),
    );
    const row = result.rows[0];
    if (!row) return;
    const revision = Number(row.revision);
    if (!Number.isSafeInteger(revision) || revision < 0 || row.items.length !== row.total)
      throw new Error('Recibo durable incoherente.');
    const results: { index: number; eventId: string | null; outcome: ItemOutcome }[] = [];
    const errors: { index: number; eventId: string | null; reason: string }[] = [];
    const pendingIndexes: number[] = [];
    const failedIndexes: number[] = [];
    const failures: { index: number; code: string }[] = [];
    let accepted = 0,
      duplicates = 0,
      rejected = 0;
    for (const [index, item] of row.items.entries()) {
      if (item.index !== index) throw new Error('Índice del recibo incoherente.');
      if (item.state === 'classified') {
        if (!item.outcome) throw new Error('Clasificación durable ausente.');
        const eventId = OriginalJson.parse(item.input).property('eventId')?.stringValue ?? null;
        results.push({ index, eventId, outcome: item.outcome });
        if (item.outcome === 'accepted') accepted += 1;
        else if (item.outcome === 'duplicate') duplicates += 1;
        else {
          if (!item.reason) throw new Error('Motivo de rechazo ausente.');
          rejected += 1;
          errors.push({ index, eventId, reason: item.reason });
        }
      } else if (item.state === 'waiting' || item.state === 'scheduled') pendingIndexes.push(index);
      else if (item.state === 'failed' || item.state === 'blocked') {
        if (!item.failure) throw new Error('Diagnóstico técnico ausente.');
        failedIndexes.push(index);
        failures.push({ index, code: item.failure });
      } else throw new Error('Estado de posición desconocido.');
    }
    const complete = results.length === row.total;
    if (
      complete !== (row.state === 'complete') ||
      (row.state === 'failed') !== failedIndexes.length > 0
    )
      throw new Error('Estado agregado del recibo incoherente.');
    return {
      ingestionId: row.ingestion_id,
      revision,
      complete,
      total: row.total,
      accepted,
      duplicates,
      rejected,
      results,
      errors,
      pendingIndexes,
      failedIndexes,
      failures,
    };
  }
}
