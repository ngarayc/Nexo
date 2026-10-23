import type { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { decodeIdentity } from '@nexo/contracts';
import type { DatabaseSlots } from '../../../../platform/database/slots.js';
import { ingestionQueue } from '../../../../platform/queue/policy.js';
import type { OfficialFixture } from '../../application/official-fixture.js';
import { replayEnvironmentValid } from '../../application/verification.js';
import type {
  EvidenceAttempt,
  EvidenceEvent,
  EvidenceReceipt,
  EvidenceRun,
  ReadReplayEvidence,
  ReplayEnvironment,
  ReplayEvidence,
} from '../../application/verification.js';

export class ReplayEvidenceUnavailable extends Error {
  constructor() {
    super('No se pudo obtener una lectura coherente para verificar la reproducción.');
  }
}
interface EventRow {
  event_key: Buffer;
  vehicle_key: Buffer;
  observed_at_original: string;
  latitude: number;
  longitude: number;
  speed_kph: number;
  ignition_on: boolean;
  extra_empty: boolean;
}
const eventColumns = `e.event_key,e.vehicle_key,e.observed_at_original,e.latitude,e.longitude,e.speed_kph,e.ignition_on,
  e.payload_extra::text='{}' AS extra_empty`;
function event(row: EventRow): EvidenceEvent {
  return {
    eventId: decodeIdentity(row.event_key),
    vehicleId: decodeIdentity(row.vehicle_key),
    observedAt: row.observed_at_original,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKph: row.speed_kph,
    ignitionOn: row.ignition_on,
    extraEmpty: row.extra_empty,
  };
}
type Counts = ReplayEvidence['counts'];
type RunRow = {
  run_id: string;
  scenario_id: string;
  previous_run_id: string | null;
  instance_id: string;
  fixture_sha256: string;
  stage: EvidenceRun['stage'];
  state: EvidenceRun['state'];
  next_line: number;
  revision: string;
  verification: EvidenceRun['verification'];
  verification_document: string | null;
  scenario_verification: EvidenceRun['scenarioVerification'];
  scenario_closed_at: string | null;
};
type AttemptRow = {
  run_id: string;
  line_number: number;
  batch_index: number;
  ingestion_id: string;
  event_key: Buffer | null;
  state: string;
  outcome: EvidenceAttempt['outcome'];
  reason_code: string | null;
};
type ReceiptRow = {
  ingestion_id: string;
  state: string;
  total: number;
  next_index: number;
  request_matches: boolean;
  item_index: number | null;
  item_state: string | null;
  input_matches: boolean | null;
  outcome: string | null;
  reason_code: string | null;
  resolved_event_key: Buffer | null;
};
function safeRevision(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ReplayEvidenceUnavailable();
  return number;
}
// Solo lecturas; no inspecciona SQL interno del broker. Los límites son muestras
// de evidencia, nunca truncamientos de GET de dominio o ceros inferidos.
export class PostgresReplayEvidence implements ReadReplayEvidence {
  constructor(
    private readonly pool: Pool,
    private readonly slots: DatabaseSlots,
    private readonly boss: PgBoss,
    private readonly fixture: OfficialFixture,
    private readonly expectedMigrationHash: string,
    private readonly environment: () => ReplayEnvironment,
  ) {}

  async read(runId?: string): Promise<ReplayEvidence> {
    if (
      runId !== undefined &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId)
    )
      throw new ReplayEvidenceUnavailable();
    return this.slots.run(async () => {
      const before = { ...this.environment() };
      if (!replayEnvironmentValid(before)) throw new ReplayEvidenceUnavailable();
      if (!/^[a-f0-9]{64}$/.test(this.expectedMigrationHash)) throw new ReplayEvidenceUnavailable();
      const client = await this.pool.connect();
      let confirmed = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL transaction_timeout='10s'");
        const {
          rows: [preparation],
        } = await client.query<{ hash: string | null; account_ready: boolean }>(`SELECT
          (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1) AS hash,
          ((SELECT count(*) FROM users)=1 AND coalesce((SELECT bool_and(username IN ('demo','Demo') AND password_hash LIKE '$argon2id$%') FROM users),false)) AS account_ready`);
        if (!preparation) throw new ReplayEvidenceUnavailable();
        const {
          rows: [counts],
        } = await client.query<Counts>(`SELECT
          (SELECT count(*)::int FROM telemetry_events) AS events,
          (SELECT count(*)::int FROM vehicle_latest) AS vehicles,
          (SELECT count(*)::int FROM alerts) AS alerts,
          (SELECT count(*)::int FROM outbox_messages) AS messages,
          (SELECT count(*)::int FROM outbox_messages WHERE published_at IS NULL) AS "pendingMessages",
          (SELECT count(*)::int FROM ingestion_batches) AS receipts,
          (SELECT count(*)::int FROM ingestion_batches WHERE state='active') AS "activeReceipts",
          (SELECT count(*)::int FROM ingestion_batches WHERE state='failed') AS "failedReceipts",
          (SELECT count(*)::int FROM replay_runs) AS runs,
          (SELECT count(*)::int FROM replay_attempts) AS attempts`);
        if (
          !counts ||
          Object.values(counts).some((value) => !Number.isSafeInteger(value) || value < 0)
        )
          throw new ReplayEvidenceUnavailable();
        const {
          rows: [clock],
        } = await client.query<{ observed_at: string }>(
          `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at`,
        );
        if (!clock) throw new ReplayEvidenceUnavailable();
        const runRows = (
          await client.query<RunRow>(
            `SELECT run_id,scenario_id,previous_run_id,instance_id,fixture_sha256,stage,state,next_line,
          revision::text,verification,verification_document::text,scenario_verification,
          to_char(scenario_closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS scenario_closed_at
          FROM replay_runs WHERE $1::uuid IS NOT NULL AND (run_id=$1 OR run_id IN
            (SELECT scenario_id FROM replay_runs WHERE run_id=$1) OR run_id IN
            (SELECT previous_run_id FROM replay_runs WHERE run_id=$1)) ORDER BY created_at,run_id`,
            [runId ?? null],
          )
        ).rows;
        const runs: EvidenceRun[] = runRows.map((row) => ({
          runId: row.run_id,
          scenarioId: row.scenario_id,
          previousRunId: row.previous_run_id,
          instanceId: row.instance_id,
          fixtureSha256: row.fixture_sha256,
          stage: row.stage,
          state: row.state,
          nextLine: row.next_line,
          revision: safeRevision(row.revision),
          verification: row.verification,
          verificationDocument: row.verification_document,
          scenarioVerification: row.scenario_verification,
          scenarioClosedAt: row.scenario_closed_at,
        }));
        const attemptRows = (
          await client.query<AttemptRow>(
            `SELECT run_id,line_number,batch_index,ingestion_id,event_key,state,outcome,reason_code
          FROM replay_attempts WHERE run_id=ANY($1::uuid[]) ORDER BY run_id,line_number`,
            [runs.map((run) => run.runId)],
          )
        ).rows;
        const attempts: EvidenceAttempt[] = attemptRows.map((row) => ({
          runId: row.run_id,
          lineNumber: row.line_number,
          batchIndex: row.batch_index,
          ingestionId: row.ingestion_id,
          eventId: row.event_key === null ? null : decodeIdentity(row.event_key),
          state: row.state,
          outcome: row.outcome,
          reasonCode: row.reason_code,
        }));
        const expected = attempts.map((attempt) => {
          const row = this.fixture.rows[attempt.lineNumber - 1];
          if (!row) throw new ReplayEvidenceUnavailable();
          return row;
        });
        const receiptRows = (
          await client.query<ReceiptRow>(
            `WITH expected AS (
          SELECT * FROM unnest($1::uuid[],$2::text[],$3::text[]) AS e(id,body,input))
          SELECT b.ingestion_id,b.state,b.total,b.next_index,b.request_document::text=e.body AS request_matches,
            i.item_index,i.state AS item_state,i.input_document::text=e.input AS input_matches,i.outcome,i.reason_code,t.event_key AS resolved_event_key
          FROM expected e JOIN ingestion_batches b ON b.ingestion_id=e.id LEFT JOIN ingestion_items i USING(ingestion_id)
          LEFT JOIN telemetry_events t ON t.event_pk=i.resolved_event_pk
          ORDER BY b.ingestion_id,i.item_index LIMIT 73`,
            [
              attempts.map((attempt) => attempt.ingestionId),
              expected.map((row) => row.body),
              expected.map((row) => row.inputDocument),
            ],
          )
        ).rows;
        const receipts: EvidenceReceipt[] = receiptRows.map((row) => ({
          ingestionId: row.ingestion_id,
          state: row.state,
          total: row.total,
          nextIndex: row.next_index,
          requestMatches: row.request_matches,
          itemIndex: row.item_index,
          itemState: row.item_state,
          inputMatches: row.input_matches,
          outcome: row.outcome,
          reasonCode: row.reason_code,
          resolvedEventId:
            row.resolved_event_key === null ? null : decodeIdentity(row.resolved_event_key),
        }));
        const receiptIds = (
          await client.query<{ id: string }>(
            'SELECT ingestion_id AS id FROM ingestion_batches ORDER BY ingestion_id LIMIT 49',
          )
        ).rows.map((row) => row.id);
        const events = (
          await client.query<EventRow>(`SELECT ${eventColumns} FROM telemetry_events e
          ORDER BY e.vehicle_key,e.observed_epoch_second,e.observed_fraction COLLATE "C",e.event_key LIMIT 21`)
        ).rows.map(event);
        const latest = (
          await client.query<
            EventRow & { status: 'MOVING' | 'STOPPED' | 'OFF' }
          >(`SELECT ${eventColumns},CASE WHEN NOT e.ignition_on THEN 'OFF'
          WHEN e.speed_kph>0 THEN 'MOVING' ELSE 'STOPPED' END AS status FROM vehicle_latest v JOIN telemetry_events e USING(event_pk)
          ORDER BY v.vehicle_key LIMIT 9`)
        ).rows.map((row) => ({ ...event(row), status: row.status }));
        const alerts = (
          await client.query<EventRow>(`SELECT ${eventColumns} FROM alerts a JOIN telemetry_events e USING(event_pk)
          ORDER BY e.observed_epoch_second DESC,e.observed_fraction COLLATE "C" DESC,e.event_key DESC LIMIT 5`)
        ).rows.map(event);
        const messages = (
          await client.query<{
            event_key: Buffer;
            type: string;
            published: boolean;
          }>(`SELECT e.event_key,o.type,o.published_at IS NOT NULL AS published
          FROM outbox_messages o JOIN telemetry_events e USING(event_pk) ORDER BY o.message_id LIMIT 44`)
        ).rows.map((row) => ({
          eventId: decodeIdentity(row.event_key),
          type: row.type,
          published: row.published,
        }));
        // queued:true excluye active; pedir todos los estados por API pública.
        // N+1 permite distinguir inventario completo del límite de lectura.
        const jobs = await this.boss.findJobs(ingestionQueue, {
          limit: 1001,
          db: fromDrizzle(drizzle(client), sql),
        });
        const jobView = {
          complete: jobs.length <= 1000,
          queued: jobs.filter((job) => job.state === 'created' || job.state === 'retry').length,
          active: jobs.filter((job) => job.state === 'active').length,
        };
        const after = { ...this.environment() };
        if (
          !replayEnvironmentValid(after) ||
          before.instanceId !== after.instanceId ||
          before.softwareFingerprint !== after.softwareFingerprint ||
          before.configurationFingerprint !== after.configurationFingerprint
        )
          throw new ReplayEvidenceUnavailable();
        await client.query('COMMIT');
        confirmed = true;
        return {
          observedAt: clock.observed_at,
          environment: {
            ...after,
            ready:
              before.ready &&
              after.ready &&
              preparation.account_ready &&
              preparation.hash === this.expectedMigrationHash,
          },
          counts,
          runs,
          attempts,
          receiptIds,
          receipts,
          events,
          latest,
          alerts,
          messages,
          jobs: jobView,
        };
      } catch {
        throw new ReplayEvidenceUnavailable();
      } finally {
        client.release(!confirmed);
      }
    });
  }
}
