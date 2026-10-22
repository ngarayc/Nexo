import type { Pool } from 'pg';
import type { OutboxFailure, OutboxStore, PendingMessage } from '../../application/dispatch.js';

export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly pool: Pool) {}

  async metadata(): Promise<readonly PendingMessage[]> {
    const result = await this.pool.query<{
      message_id: string;
      frame_bytes: number;
      type: string;
      schema_version: number;
    }>(`SELECT message_id,frame_bytes,type,schema_version FROM outbox_messages
      WHERE published_at IS NULL AND available_at<=clock_timestamp()
      ORDER BY available_at,created_at,message_id LIMIT 100`);
    return result.rows.map((row) => ({
      messageId: row.message_id,
      frameBytes: row.frame_bytes,
      type: row.type,
      schemaVersion: row.schema_version,
    }));
  }
  async payloads(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const result = await this.pool.query<{ message_id: string; payload: string }>(
      'SELECT message_id,payload::text FROM outbox_messages WHERE message_id=ANY($1::uuid[])',
      [ids],
    );
    return new Map(result.rows.map((row) => [row.message_id, row.payload]));
  }
  async publish(ids: readonly string[]): Promise<void> {
    const result = await this.pool.query(
      `UPDATE outbox_messages SET published_at=clock_timestamp(),last_error_code=NULL
       WHERE message_id=ANY($1::uuid[]) AND published_at IS NULL RETURNING message_id`,
      [ids],
    );
    if (result.rows.length !== ids.length) throw new Error('OUTBOX_MARK_UNCONFIRMED');
  }
  async published(ids: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    const result = await this.pool.query<{ message_id: string; published: boolean }>(
      'SELECT message_id,published_at IS NOT NULL AS published FROM outbox_messages WHERE message_id=ANY($1::uuid[])',
      [ids],
    );
    return new Map(result.rows.map((row) => [row.message_id, row.published]));
  }
  async fail(ids: readonly string[], code: OutboxFailure): Promise<void> {
    const result = await this.pool.query(
      `UPDATE outbox_messages SET
       available_at=clock_timestamp()+
         LEAST(30,power(2,LEAST(attempts,5))*(1+random()*0.25))*interval '1 second',
       attempts=LEAST(attempts::bigint+1,2147483647)::integer,last_error_code=$2
       WHERE message_id=ANY($1::uuid[]) AND published_at IS NULL RETURNING message_id`,
      [ids, code],
    );
    if (result.rows.length !== ids.length) throw new Error('OUTBOX_STATE_UNAVAILABLE');
  }
  async metrics() {
    const result = await this.pool.query<{
      pending: string;
      failures: string;
      oldest_ms: number;
    }>(`SELECT count(*)::text AS pending,
      count(*) FILTER (WHERE last_error_code IS NOT NULL)::text AS failures,
      coalesce(GREATEST(0,extract(epoch FROM clock_timestamp()-min(created_at))*1000),0)::float8 AS oldest_ms
      FROM outbox_messages WHERE published_at IS NULL`);
    const row = result.rows[0];
    if (!row) throw new Error('OUTBOX_STATE_UNAVAILABLE');
    return {
      pending: Number(row.pending),
      failures: Number(row.failures),
      oldestMilliseconds: row.oldest_ms,
    };
  }
}
