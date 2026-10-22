import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { replayRuns, replayAttempts } from '../../../../platform/database/schema.js';
import { WriteTransactions } from '../../../../platform/database/write-transactions.js';
import type { DatabaseSlots } from '../../../../platform/database/slots.js';
import { encodeIdentity, decodeIdentity, readObservedInstant } from '@nexo/contracts';
import {
  ReplayCapacity,
  ReplayConflict,
  ReplayInputError,
  ReplayInvariantError,
  replayDiagnostic,
  replayFailureCodes,
  replayInterval,
  replayProgress,
  replayRunLimit,
  replayStates,
  terminalReplay,
} from '../../domain/replay.js';
import type { AttemptState, ReplayState, VerificationResult } from '../../domain/replay.js';
import type {
  AttemptResolution,
  HistoryPage,
  NewReplayRun,
  ReplayAttempt,
  ReplayIntention,
  IntentionConfirmation,
  ReplayJournal,
  ReplayRun,
  ReplaySnapshot,
  ReplayTransition,
} from '../../application/journal.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function identity(value: string): void {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ReplayInputError();
}
const instant = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const runFields = {
  ...getTableColumns(replayRuns),
  revision: sql<string>`${replayRuns.revision}::text`,
  verificationDocument: sql<string | null>`${replayRuns.verificationDocument}::text`,
  scenarioDocument: sql<string | null>`${replayRuns.scenarioDocument}::text`,
  lastCommandDocument: sql<string | null>`${replayRuns.lastCommandDocument}::text`,
  lastCommandExpectedVersion: sql<string | null>`${replayRuns.lastCommandExpectedVersion}::text`,
  createdAt: instant(replayRuns.createdAt),
  updatedAt: instant(replayRuns.updatedAt),
  scenarioClosedAt: sql<string | null>`${instant(replayRuns.scenarioClosedAt)}`,
};
const attemptFields = {
  ...getTableColumns(replayAttempts),
  diagnosticDocument: sql<string | null>`${replayAttempts.diagnosticDocument}::text`,
  startedAt: instant(replayAttempts.startedAt),
  finalizedAt: sql<string | null>`${instant(replayAttempts.finalizedAt)}`,
};
function safeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ReplayInvariantError();
  return number;
}
function runView(row: RunRow): ReplayRun {
  const {
    lastCommandId,
    lastCommandInstance,
    lastCommandExpectedVersion,
    lastCommandDocument,
    ...rest
  } = row;
  let intention: ReplayIntention | null = null;
  if (lastCommandId !== null) {
    if (
      lastCommandInstance === null ||
      lastCommandExpectedVersion === null ||
      lastCommandDocument === null
    )
      throw new ReplayInvariantError();
    intention = Object.freeze({
      commandId: lastCommandId,
      instanceId: lastCommandInstance,
      expectedControlVersion: safeInteger(lastCommandExpectedVersion),
      document: lastCommandDocument,
    });
  }
  return Object.freeze({
    ...rest,
    revision: safeInteger(row.revision),
    state: row.state as ReplayState,
    stage: row.stage as ReplayRun['stage'],
    verification: row.verification as VerificationResult,
    scenarioVerification: row.scenarioVerification as VerificationResult,
    closeCode: row.closeCode as ReplayRun['closeCode'],
    intention,
  });
}
type RunRow = Awaited<ReturnType<typeof selectRuns>>[number];
function selectRuns(tx: NodePgDatabase) {
  return tx.select(runFields).from(replayRuns);
}
function documentObject(document: string): void {
  let value: unknown;
  try {
    value = JSON.parse(document);
  } catch {
    throw new ReplayInputError();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ReplayInputError();
}
function intentionFields(intention?: ReplayIntention) {
  if (!intention) return {};
  identity(intention.commandId);
  identity(intention.instanceId);
  if (
    !Number.isSafeInteger(intention.expectedControlVersion) ||
    intention.expectedControlVersion < 0 ||
    intention.expectedControlVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new ReplayInputError();
  documentObject(intention.document);
  if (Buffer.byteLength(intention.document) > 4096) throw new ReplayInputError();
  const parsed: Record<string, unknown> = JSON.parse(intention.document);
  if (
    Object.keys(parsed).some(
      (key) =>
        ![
          'commandId',
          'instanceId',
          'expectedControlVersion',
          'runId',
          'action',
          'intervalMs',
        ].includes(key),
    ) ||
    parsed['commandId'] !== intention.commandId ||
    parsed['instanceId'] !== intention.instanceId ||
    parsed['expectedControlVersion'] !== intention.expectedControlVersion ||
    typeof parsed['action'] !== 'string' ||
    !['start', 'pause', 'resume', 'restart', 'finishVerification'].includes(parsed['action'])
  )
    throw new ReplayInputError();
  if (parsed['runId'] !== null) identity(parsed['runId'] as string);
  if ((parsed['action'] === 'start') !== (parsed['runId'] === null)) throw new ReplayInputError();
  if (Object.hasOwn(parsed, 'intervalMs')) {
    if (!['start', 'resume', 'restart'].includes(parsed['action'])) throw new ReplayInputError();
    replayInterval(parsed['intervalMs']);
  }
  return {
    lastCommandId: intention.commandId,
    lastCommandInstance: intention.instanceId,
    lastCommandExpectedVersion: BigInt(intention.expectedControlVersion),
    lastCommandDocument: intention.document,
  };
}
function checkedDiagnostic(document: string): string {
  if (typeof document !== 'string' || Buffer.byteLength(document) > 4096)
    throw new ReplayInputError();
  documentObject(document);
  const { code, truncated, ...details }: Record<string, unknown> = JSON.parse(document);
  if (
    typeof code !== 'string' ||
    !replayFailureCodes.includes(code as (typeof replayFailureCodes)[number]) ||
    typeof truncated !== 'boolean'
  )
    throw new ReplayInputError();
  const normalized: Record<string, unknown> = JSON.parse(
    replayDiagnostic(code as (typeof replayFailureCodes)[number], details),
  );
  if (normalized['truncated'] !== false) throw new ReplayInputError();
  return JSON.stringify({ ...normalized, truncated });
}
function historyKey(cursor: string): { createdAt: string; runId: string } {
  if (typeof cursor !== 'string' || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new ReplayInputError();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ReplayInputError();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ReplayInputError();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record['createdAt'] !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(record['createdAt']) ||
    !readObservedInstant(record['createdAt'])
  )
    throw new ReplayInputError();
  identity(record['runId'] as string);
  return { createdAt: record['createdAt'], runId: record['runId'] as string };
}

export class PostgresReplayJournal implements ReplayJournal {
  private readonly writes: WriteTransactions;
  constructor(
    writePool: Pool,
    private readonly readPool: Pool,
    private readonly writeSlots: DatabaseSlots,
    private readonly readSlots: DatabaseSlots,
  ) {
    this.writes = new WriteTransactions(writePool);
  }
  private write<T>(operation: (tx: NodePgDatabase) => Promise<T>): Promise<T> {
    return this.writeSlots.run(() =>
      this.writes.run(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(72416003)`);
        return operation(tx);
      }),
    );
  }
  private read<T>(operation: (tx: NodePgDatabase) => Promise<T>): Promise<T> {
    return this.readSlots.run(async () => {
      const client = await this.readPool.connect();
      let confirmed = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL transaction_timeout='10s'");
        const result = await operation(drizzle(client));
        await client.query('COMMIT');
        confirmed = true;
        return result;
      } finally {
        client.release(!confirmed);
      }
    });
  }
  private async snapshot(tx: NodePgDatabase, runId: string): Promise<ReplaySnapshot | undefined> {
    const [row] = await selectRuns(tx).where(eq(replayRuns.runId, runId));
    if (!row) return undefined;
    const run = runView(row);
    const stored = await tx
      .select(attemptFields)
      .from(replayAttempts)
      .where(eq(replayAttempts.runId, runId))
      .orderBy(replayAttempts.lineNumber);
    const attempts: readonly ReplayAttempt[] = Object.freeze(
      stored.map(({ eventKey, ...row }) =>
        Object.freeze({
          ...row,
          batchIndex: 0 as const,
          state: row.state as AttemptState,
          outcome: row.outcome as ReplayAttempt['outcome'],
          eventId: eventKey === null ? null : decodeIdentity(eventKey),
        }),
      ),
    );
    const progress = replayProgress(attempts);
    if (run.nextLine !== progress.nextLine) throw new ReplayInvariantError();
    return Object.freeze({ run, attempts, progress });
  }
  private async fenced(
    tx: NodePgDatabase,
    runId: string,
    revision: number,
  ): Promise<ReplaySnapshot> {
    identity(runId);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ReplayInputError();
    if (revision >= Number.MAX_SAFE_INTEGER) throw new ReplayCapacity();
    await tx
      .select({ runId: replayRuns.runId })
      .from(replayRuns)
      .where(eq(replayRuns.runId, runId))
      .for('update');
    const current = await this.snapshot(tx, runId);
    if (!current || current.run.revision !== revision) throw new ReplayConflict();
    return current;
  }
  private async update(
    tx: NodePgDatabase,
    run: ReplayRun,
    change: ReplayTransition,
    nextLine = run.nextLine,
  ) {
    if (!replayStates.includes(change.state)) throw new ReplayInputError();
    if (change.intervalMs !== undefined) replayInterval(change.intervalMs);
    if (change.closeCode !== undefined && !replayFailureCodes.includes(change.closeCode))
      throw new ReplayInputError();
    let verification =
      ['stopped', 'error', 'interrupted'].includes(change.state) && run.verification === 'pending'
        ? 'inconclusive'
        : run.verification;
    if (change.finalVerification !== undefined) {
      const final = change.finalVerification;
      if (!final || !['inconclusive', 'non_conformant'].includes(final.result))
        throw new ReplayInputError();
      documentObject(final.document);
      if (
        run.verification !== 'pending' ||
        !['stopped', 'error', 'interrupted'].includes(change.state)
      )
        throw new ReplayConflict();
      verification = final.result;
    }
    await tx
      .update(replayRuns)
      .set({
        state: change.state,
        nextLine,
        intervalMs: change.intervalMs ?? run.intervalMs,
        closeCode: change.closeCode ?? run.closeCode,
        verification,
        verificationDocument: change.finalVerification?.document ?? run.verificationDocument,
        revision: sql`${replayRuns.revision}+1`,
        updatedAt: sql`clock_timestamp()`,
        ...intentionFields(change.intention),
      })
      .where(eq(replayRuns.runId, run.runId));
    return (await this.snapshot(tx, run.runId))!;
  }
  async create(input: NewReplayRun): Promise<ReplaySnapshot> {
    for (const id of [input.runId, input.scenarioId, input.instanceId]) identity(id);
    if (input.previousRunId !== null) identity(input.previousRunId);
    replayInterval(input.intervalMs);
    if (typeof input.fixtureSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.fixtureSha256))
      throw new ReplayInputError();
    return this.write(async (tx) => {
      const count = await tx.select({ total: sql<number>`count(*)::int` }).from(replayRuns);
      if (count[0]!.total >= replayRunLimit) throw new ReplayCapacity();
      if (
        (
          await tx
            .select({ runId: replayRuns.runId })
            .from(replayRuns)
            .where(
              sql`${replayRuns.state} IN ('preparing','running','pausing','paused','restarting','finalizing')`,
            )
        ).length
      )
        throw new ReplayConflict();
      await tx.insert(replayRuns).values({
        runId: input.runId,
        scenarioId: input.scenarioId,
        previousRunId: input.previousRunId,
        instanceId: input.instanceId,
        fixtureSha256: input.fixtureSha256,
        stage: input.stage,
        intervalMs: input.intervalMs,
        ...intentionFields(input.intention),
      });
      return (await this.snapshot(tx, input.runId))!;
    });
  }
  async find(runId: string) {
    identity(runId);
    return this.read((tx) => this.snapshot(tx, runId));
  }
  async confirmIntention(
    runId: string,
    previousRevision: number | null,
    intention: ReplayIntention,
  ): Promise<IntentionConfirmation> {
    identity(runId);
    if (!intention) throw new ReplayInputError();
    intentionFields(intention);
    if (
      previousRevision !== null &&
      (!Number.isSafeInteger(previousRevision) || previousRevision < 0)
    )
      throw new ReplayInputError();
    // write toma primero el mismo advisory lock del escritor incierto. En READ
    // COMMITTED, la lectura posterior ya ve su commit/rollback. Un find404 sin
    // esa barrera no acredita que la transacción anterior haya terminado.
    return this.write(async (tx) => {
      const snapshot = await this.snapshot(tx, runId),
        marker = snapshot?.run.intention;
      if (!snapshot)
        return { state: previousRevision === null ? 'not_applied' : 'unknown', snapshot: null };
      if (
        marker?.commandId === intention.commandId &&
        marker.instanceId === intention.instanceId &&
        marker.expectedControlVersion === intention.expectedControlVersion &&
        marker.document === intention.document
      )
        return { state: 'applied', snapshot };
      if (previousRevision !== null && snapshot.run.revision === previousRevision)
        return { state: 'not_applied', snapshot };
      return { state: 'unknown', snapshot };
    });
  }
  async current() {
    return this.read(async (tx) => {
      const [latest] = await tx
        .select({ runId: replayRuns.runId })
        .from(replayRuns)
        .orderBy(desc(replayRuns.createdAt), desc(replayRuns.runId))
        .limit(1);
      return latest ? this.snapshot(tx, latest.runId) : undefined;
    });
  }
  async history(limit = 20, cursor?: string): Promise<HistoryPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ReplayInputError();
    const key = cursor === undefined ? undefined : historyKey(cursor);
    return this.read(async (tx) => {
      const rows = await tx
        .select(runFields)
        .from(replayRuns)
        .where(
          key
            ? sql`(${replayRuns.createdAt},${replayRuns.runId}) < (${key.createdAt}::timestamptz,${key.runId}::uuid)`
            : undefined,
        )
        .orderBy(desc(replayRuns.createdAt), desc(replayRuns.runId))
        .limit(limit + 1);
      const items = rows.slice(0, limit).map(runView);
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({ createdAt: last.createdAt, runId: last.runId }),
              ).toString('base64url')
            : null,
      };
    });
  }
  async transition(runId: string, revision: number, change: ReplayTransition) {
    return this.write(async (tx) =>
      this.update(tx, (await this.fenced(tx, runId, revision)).run, change),
    );
  }
  async beginAttempt(runId: string, revision: number, ingestionId: string, eventId: string | null) {
    identity(ingestionId);
    if (eventId !== null && (typeof eventId !== 'string' || eventId.length === 0))
      throw new ReplayInputError();
    return this.write(async (tx) => {
      const current = await this.fenced(tx, runId, revision);
      if (
        current.run.state !== 'running' ||
        current.run.nextLine > 24 ||
        current.attempts.length !== current.progress.classified
      )
        throw new ReplayConflict();
      await tx.insert(replayAttempts).values({
        runId,
        lineNumber: current.run.nextLine,
        ingestionId,
        eventKey: eventId === null ? null : encodeIdentity(eventId),
      });
      return this.update(tx, current.run, { state: 'running' });
    });
  }
  async resolveAttempt(
    runId: string,
    revision: number,
    result: AttemptResolution,
    change: ReplayTransition,
  ) {
    return this.write(async (tx) => {
      const current = await this.fenced(tx, runId, revision);
      const attempt = current.attempts.at(-1);
      if (!attempt || attempt.state !== 'in_flight') throw new ReplayConflict();
      if (
        result.state !== 'classified' &&
        (!terminalReplay(change.state) || change.state === 'completed')
      )
        throw new ReplayInvariantError();
      const values =
        result.state === 'classified'
          ? {
              state: result.state,
              outcome: result.outcome,
              reasonCode: result.reasonCode,
              httpStatus: 200,
            }
          : {
              state: result.state,
              diagnosticDocument: checkedDiagnostic(result.diagnosticDocument),
              httpStatus: result.httpStatus,
            };
      await tx
        .update(replayAttempts)
        .set({ ...values, finalizedAt: sql`clock_timestamp()` })
        .where(
          and(eq(replayAttempts.runId, runId), eq(replayAttempts.lineNumber, attempt.lineNumber)),
        );
      const nextLine = current.run.nextLine + (result.state === 'classified' ? 1 : 0);
      return this.update(
        tx,
        current.run,
        { ...change, state: nextLine === 25 ? 'completed' : change.state },
        nextLine,
      );
    });
  }
  async verify(
    runId: string,
    revision: number,
    result: Exclude<VerificationResult, 'pending'>,
    document: string,
  ) {
    documentObject(document);
    return this.write(async (tx) => {
      const current = await this.fenced(tx, runId, revision);
      if (!terminalReplay(current.run.state) || current.run.verification !== 'pending')
        throw new ReplayConflict();
      await tx
        .update(replayRuns)
        .set({
          verification: result,
          verificationDocument: document,
          revision: sql`${replayRuns.revision}+1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(replayRuns.runId, runId));
      return (await this.snapshot(tx, runId))!;
    });
  }
  async closeScenario(
    runId: string,
    revision: number,
    result: Exclude<VerificationResult, 'pending'>,
    document: string,
  ) {
    documentObject(document);
    return this.write(async (tx) => {
      const current = await this.fenced(tx, runId, revision);
      if (current.run.stage !== 'first' || current.run.scenarioVerification !== 'pending')
        throw new ReplayConflict();
      await tx
        .update(replayRuns)
        .set({
          scenarioVerification: result,
          scenarioDocument: document,
          scenarioClosedAt: sql`clock_timestamp()`,
          revision: sql`${replayRuns.revision}+1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(replayRuns.runId, runId));
      return (await this.snapshot(tx, runId))!;
    });
  }
  async recover(): Promise<number> {
    return this.write(async (tx) => {
      const active = sql`state IN ('preparing','running','pausing','paused','restarting','finalizing')`;
      await tx
        .update(replayAttempts)
        .set({
          state: 'uncertain',
          diagnosticDocument: replayDiagnostic('API_RESTARTED'),
          finalizedAt: sql`clock_timestamp()`,
        })
        .where(
          sql`state='in_flight' AND run_id IN (SELECT run_id FROM replay_runs WHERE ${active})`,
        );
      const recovered = await tx
        .update(replayRuns)
        .set({
          state: 'interrupted',
          verification: 'inconclusive',
          closeCode: 'API_RESTARTED',
          revision: sql`${replayRuns.revision}+1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(active)
        .returning({ runId: replayRuns.runId });
      return recovered.length;
    });
  }
}
