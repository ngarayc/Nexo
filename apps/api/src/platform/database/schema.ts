import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const identityBytes = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});
// pg convierte json por defecto. Leer estos campos exige un CAST explícito a text.
const originalJson = customType<{ data: string; driverData: string }>({
  dataType: () => 'json',
  toDriver: (value) => value,
  fromDriver: () => {
    throw new Error('Los documentos JSON deben leerse mediante conversión a texto.');
  },
});
const exactFraction = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });
const technicalTime = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: technicalTime('created_at').defaultNow().notNull(),
  },
  (table) => [check('users_demo_only', sql`${table.username} = 'demo'`)],
);

export const telemetryEvents = pgTable(
  'telemetry_events',
  {
    eventPk: bigint('event_pk', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    eventKey: identityBytes('event_key').notNull(),
    vehicleKey: identityBytes('vehicle_key').notNull(),
    observedAtOriginal: text('observed_at_original').notNull(),
    observedEpochSecond: bigint('observed_epoch_second', { mode: 'bigint' }).notNull(),
    observedFraction: exactFraction('observed_fraction').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    speedKph: doublePrecision('speed_kph').notNull(),
    ignitionOn: boolean('ignition_on').notNull(),
    payloadExtra: originalJson('payload_extra').notNull(),
  },
  (table) => [
    check(
      'telemetry_events_event_key_canonical',
      sql`nexo_identity_is_canonical(${table.eventKey})`,
    ),
    check(
      'telemetry_events_vehicle_key_canonical',
      sql`nexo_identity_is_canonical(${table.vehicleKey})`,
    ),
    check(
      'telemetry_events_observed_original_present',
      sql`length(${table.observedAtOriginal}) > 0`,
    ),
    check(
      'telemetry_events_fraction_canonical',
      sql`${table.observedFraction} ~ '^(|[0-9]*[1-9])$'`,
    ),
    check(
      'telemetry_events_latitude_valid',
      sql`${table.latitude} BETWEEN -90 AND 90 AND ${table.latitude} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`,
    ),
    check(
      'telemetry_events_longitude_valid',
      sql`${table.longitude} BETWEEN -180 AND 180 AND ${table.longitude} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`,
    ),
    check(
      'telemetry_events_speed_valid',
      sql`${table.speedKph} >= 0 AND ${table.speedKph} NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`,
    ),
    index('telemetry_events_vehicle_key_hash').using('hash', table.vehicleKey),
  ],
);

export const vehicleLatest = pgTable(
  'vehicle_latest',
  {
    vehiclePk: bigint('vehicle_pk', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
    vehicleKey: identityBytes('vehicle_key').notNull(),
    eventPk: bigint('event_pk', { mode: 'bigint' })
      .notNull()
      .references(() => telemetryEvents.eventPk),
  },
  (table) => [
    check('vehicle_latest_key_canonical', sql`nexo_identity_is_canonical(${table.vehicleKey})`),
  ],
);

export const alerts = pgTable(
  'alerts',
  {
    eventPk: bigint('event_pk', { mode: 'bigint' })
      .primaryKey()
      .references(() => telemetryEvents.eventPk),
    type: text('type').notNull(),
  },
  (table) => [check('alerts_type_valid', sql`${table.type} = 'OVERSPEED'`)],
);

export const ingestionBatches = pgTable(
  'ingestion_batches',
  {
    ingestionId: uuid('ingestion_id').primaryKey(),
    requestDocument: originalJson('request_document').notNull(),
    total: integer('total').notNull(),
    inputBytes: bigint('input_bytes', { mode: 'bigint' }).notNull(),
    state: text('state').notNull().default('active'),
    nextIndex: integer('next_index').notNull().default(0),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    receivedAt: technicalTime('received_at').notNull().defaultNow(),
    updatedAt: technicalTime('updated_at').notNull().defaultNow(),
    failedIndex: integer('failed_index'),
    failureCode: text('failure_code'),
  },
  (table) => [
    check('ingestion_batches_total_valid', sql`${table.total} BETWEEN 1 AND 1000`),
    check('ingestion_batches_input_bytes_positive', sql`${table.inputBytes} > 0`),
    check('ingestion_batches_revision_valid', sql`${table.revision} >= 0`),
    check('ingestion_batches_cursor_valid', sql`${table.nextIndex} BETWEEN 0 AND ${table.total}`),
    check(
      'ingestion_batches_failure_code_valid',
      sql`${table.failureCode} IS NULL OR ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      'ingestion_batches_state_consistent',
      sql`
    (${table.state} = 'active' AND ${table.nextIndex} < ${table.total} AND ${table.failedIndex} IS NULL AND ${table.failureCode} IS NULL)
    OR (${table.state} = 'complete' AND ${table.nextIndex} = ${table.total} AND ${table.failedIndex} IS NULL AND ${table.failureCode} IS NULL)
    OR (${table.state} = 'failed' AND ${table.nextIndex} < ${table.total} AND ${table.failedIndex} = ${table.nextIndex} AND ${table.failedIndex} IS NOT NULL AND ${table.failureCode} IS NOT NULL)
  `,
    ),
    index('ingestion_batches_active_cursor')
      .on(table.receivedAt, table.ingestionId)
      .where(sql`${table.state} = 'active'`),
  ],
);

export const ingestionItems = pgTable(
  'ingestion_items',
  {
    ingestionId: uuid('ingestion_id')
      .notNull()
      .references(() => ingestionBatches.ingestionId),
    itemIndex: integer('item_index').notNull(),
    inputDocument: originalJson('input_document').notNull(),
    state: text('state').notNull().default('waiting'),
    outcome: text('outcome'),
    reasonCode: text('reason_code'),
    resolvedEventPk: bigint('resolved_event_pk', { mode: 'bigint' }).references(
      () => telemetryEvents.eventPk,
    ),
    generation: integer('generation').notNull().default(0),
    opportunitiesReserved: integer('opportunities_reserved').notNull().default(0),
    attemptLimit: integer('attempt_limit').notNull().default(3),
    policyVersion: integer('policy_version').notNull().default(1),
    jobId: uuid('job_id'),
    notBefore: technicalTime('not_before'),
    failureCode: text('failure_code'),
    lastFailureGeneration: integer('last_failure_generation'),
    lastFailureAt: technicalTime('last_failure_at'),
    finalizedAt: technicalTime('finalized_at'),
  },
  (table) => [
    primaryKey({ columns: [table.ingestionId, table.itemIndex] }),
    check('ingestion_items_index_valid', sql`${table.itemIndex} BETWEEN 0 AND 999`),
    check(
      'ingestion_items_budget_valid',
      sql`${table.attemptLimit} > 0 AND ${table.policyVersion} > 0 AND ${table.opportunitiesReserved} BETWEEN 0 AND ${table.attemptLimit} AND ${table.generation} = ${table.opportunitiesReserved}`,
    ),
    check(
      'ingestion_items_reason_valid',
      sql`${table.reasonCode} IS NULL OR ${table.reasonCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      'ingestion_items_failure_code_valid',
      sql`${table.failureCode} IS NULL OR ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      'ingestion_items_result_consistent',
      sql`
    (${table.state} = 'classified' AND ${table.outcome} IS NOT NULL AND (
      (${table.outcome} IN ('accepted', 'duplicate') AND ${table.outcome} IS NOT NULL AND ${table.resolvedEventPk} IS NOT NULL AND ${table.reasonCode} IS NULL)
      OR (${table.outcome} = 'rejected' AND ${table.resolvedEventPk} IS NULL AND ${table.reasonCode} IS NOT NULL)
    )) OR (${table.state} <> 'classified' AND ${table.outcome} IS NULL AND ${table.reasonCode} IS NULL AND ${table.resolvedEventPk} IS NULL)
  `,
    ),
    check(
      'ingestion_items_state_consistent',
      sql`
    (${table.state} = 'waiting' AND ${table.generation} = 0 AND ${table.jobId} IS NULL AND ${table.notBefore} IS NULL AND ${table.finalizedAt} IS NULL AND ${table.failureCode} IS NULL)
    OR (${table.state} = 'scheduled' AND ${table.generation} > 0 AND ${table.jobId} IS NOT NULL AND ${table.notBefore} IS NOT NULL AND ${table.finalizedAt} IS NULL)
    OR (${table.state} = 'classified' AND ${table.generation} > 0 AND ${table.jobId} IS NOT NULL AND ${table.notBefore} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL)
    OR (${table.state} = 'failed' AND (
      ${table.opportunitiesReserved} = ${table.attemptLimit}
      OR ${table.failureCode} IN ('QUEUE_CANCELLED','QUEUE_PROTOCOL_VIOLATION','SCHEMA_INCOMPATIBLE','INGESTION_INVARIANT')
    ) AND ${table.generation} > 0 AND ${table.jobId} IS NOT NULL AND ${table.notBefore} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL AND ${table.failureCode} IS NOT NULL)
    OR (${table.state} = 'blocked' AND ${table.generation} = 0 AND ${table.jobId} IS NULL AND ${table.notBefore} IS NULL AND ${table.finalizedAt} IS NOT NULL AND ${table.failureCode} IS NOT NULL)
  `,
    ),
    check(
      'ingestion_items_failure_metadata_consistent',
      sql`
    (${table.state} = 'blocked' AND ${table.lastFailureGeneration} IS NULL AND ${table.lastFailureAt} IS NULL)
    OR (${table.state} <> 'blocked' AND (
      (${table.failureCode} IS NULL AND ${table.lastFailureGeneration} IS NULL AND ${table.lastFailureAt} IS NULL)
      OR (${table.failureCode} IS NOT NULL AND ${table.lastFailureGeneration} IS NOT NULL AND ${table.lastFailureGeneration} BETWEEN 1 AND ${table.generation} AND ${table.lastFailureAt} IS NOT NULL)
    ))
  `,
    ),
    uniqueIndex('ingestion_items_one_scheduled_per_batch')
      .on(table.ingestionId)
      .where(sql`${table.state} = 'scheduled'`),
  ],
);

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    messageId: uuid('message_id').primaryKey(),
    eventPk: bigint('event_pk', { mode: 'bigint' })
      .notNull()
      .references(() => telemetryEvents.eventPk),
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payload: originalJson('payload').notNull(),
    frameBytes: integer('frame_bytes').notNull(),
    createdAt: technicalTime('created_at').notNull().defaultNow(),
    availableAt: technicalTime('available_at').notNull().defaultNow(),
    publishedAt: technicalTime('published_at'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
  },
  (table) => [
    check(
      'outbox_messages_type_valid',
      sql`${table.type} IN ('telemetry.accepted', 'vehicle.updated', 'alert.created')`,
    ),
    check(
      'outbox_messages_shape_valid',
      sql`${table.schemaVersion} > 0 AND ${table.frameBytes} > 0 AND ${table.attempts} >= 0`,
    ),
    check(
      'outbox_messages_error_valid',
      sql`${table.lastErrorCode} IS NULL OR ${table.lastErrorCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    uniqueIndex('outbox_messages_event_type_unique').on(table.eventPk, table.type),
    index('outbox_messages_unpublished')
      .on(table.availableAt, table.createdAt, table.messageId)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);

export const replayRuns = pgTable(
  'replay_runs',
  {
    runId: uuid('run_id').primaryKey(),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references((): AnyPgColumn => replayRuns.runId),
    previousRunId: uuid('previous_run_id').references((): AnyPgColumn => replayRuns.runId),
    instanceId: uuid('instance_id').notNull(),
    fixtureSha256: text('fixture_sha256').notNull(),
    stage: text('stage').notNull(),
    intervalMs: integer('interval_ms').notNull().default(750),
    state: text('state').notNull().default('preparing'),
    nextLine: integer('next_line').notNull().default(1),
    revision: bigint('revision', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    verification: text('verification').notNull().default('pending'),
    verificationDocument: originalJson('verification_document'),
    scenarioVerification: text('scenario_verification').notNull().default('pending'),
    scenarioDocument: originalJson('scenario_document'),
    scenarioClosedAt: technicalTime('scenario_closed_at'),
    closeCode: text('close_code'),
    lastCommandId: uuid('last_command_id'),
    lastCommandInstance: uuid('last_command_instance'),
    lastCommandExpectedVersion: bigint('last_command_expected_version', { mode: 'bigint' }),
    lastCommandDocument: originalJson('last_command_document'),
    createdAt: technicalTime('created_at').notNull().defaultNow(),
    updatedAt: technicalTime('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('replay_runs_fixture_valid', sql`${table.fixtureSha256} ~ '^[a-f0-9]{64}$'`),
    check('replay_runs_interval_valid', sql`${table.intervalMs} BETWEEN 100 AND 5000`),
    check('replay_runs_revision_valid', sql`${table.revision} BETWEEN 0 AND 9007199254740991`),
    check('replay_runs_cursor_valid', sql`${table.nextLine} BETWEEN 1 AND 25`),
    check('replay_runs_time_valid', sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      'replay_runs_stage_valid',
      sql`
      (${table.stage} = 'first' AND ${table.previousRunId} IS NULL AND ${table.scenarioId} = ${table.runId})
      OR (${table.stage} IN ('second','exploratory') AND ${table.previousRunId} IS NOT NULL
          AND ${table.previousRunId} <> ${table.runId} AND ${table.scenarioId} <> ${table.runId})
    `,
    ),
    check(
      'replay_runs_state_valid',
      sql`
      (${table.state} = 'preparing' AND ${table.nextLine} = 1)
      OR (${table.state} IN ('running','pausing','paused','restarting','finalizing') AND ${table.nextLine} <= 24)
      OR (${table.state} = 'completed' AND ${table.nextLine} = 25)
      OR (${table.state} IN ('stopped','error','interrupted') AND ${table.nextLine} <= 24)
    `,
    ),
    check(
      'replay_runs_verification_valid',
      sql`
      (${table.verification} = 'pending' AND ${table.verificationDocument} IS NULL
        AND ${table.state} NOT IN ('stopped','error','interrupted'))
      OR (${table.verification} = 'inconclusive' AND ${table.state} IN ('completed','stopped','error','interrupted'))
      OR (${table.verification} = 'conformant' AND ${table.verificationDocument} IS NOT NULL AND ${table.state} = 'completed')
      OR (${table.verification} = 'non_conformant' AND ${table.verificationDocument} IS NOT NULL
        AND ${table.state} IN ('completed','stopped','error','interrupted'))
    `,
    ),
    check(
      'replay_runs_report_object',
      sql`
      ${table.verificationDocument} IS NULL OR json_typeof(${table.verificationDocument}) = 'object'
    `,
    ),
    check(
      'replay_runs_scenario_result_valid',
      sql`
      (${table.scenarioVerification} = 'pending' AND ${table.scenarioDocument} IS NULL AND ${table.scenarioClosedAt} IS NULL)
      OR (${table.stage} = 'first' AND ${table.scenarioClosedAt} IS NOT NULL AND ${table.scenarioClosedAt} >= ${table.createdAt}
        AND ((${table.scenarioVerification} = 'inconclusive')
          OR (${table.scenarioVerification} IN ('conformant','non_conformant') AND ${table.scenarioDocument} IS NOT NULL))
        AND (${table.scenarioDocument} IS NULL OR json_typeof(${table.scenarioDocument}) = 'object'))
    `,
    ),
    check(
      'replay_runs_close_code_valid',
      sql`
      ${table.closeCode} IS NULL OR ${table.closeCode} IN ('TRANSPORT_UNCERTAIN','RESPONSE_PENDING',
      'RESPONSE_INVALID','JOURNAL_UNCERTAIN','NOT_ADMITTED','PROCESSING_FAILED','API_RESTARTED',
      'USER_RESTARTED','VERIFICATION_CLOSED')
    `,
    ),
    check(
      'replay_runs_intention_valid',
      sql`
      (${table.lastCommandId} IS NULL AND ${table.lastCommandInstance} IS NULL
        AND ${table.lastCommandExpectedVersion} IS NULL AND ${table.lastCommandDocument} IS NULL)
      OR (${table.lastCommandId} IS NOT NULL AND ${table.lastCommandInstance} IS NOT NULL
        AND ${table.lastCommandExpectedVersion} IS NOT NULL AND ${table.lastCommandDocument} IS NOT NULL
        AND ${table.lastCommandExpectedVersion} BETWEEN 0 AND 9007199254740990
        AND json_typeof(${table.lastCommandDocument}) = 'object'
        AND octet_length(${table.lastCommandDocument}::text) <= 4096)
    `,
    ),
    uniqueIndex('replay_runs_one_current').on(sql`(true)`).where(sql`${table.state} IN
      ('preparing','running','pausing','paused','restarting','finalizing')`),
    uniqueIndex('replay_runs_one_second')
      .on(table.scenarioId)
      .where(sql`${table.stage} = 'second'`),
    index('replay_runs_history').on(table.createdAt.desc(), table.runId.desc()),
  ],
);

export const replayAttempts = pgTable(
  'replay_attempts',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => replayRuns.runId),
    lineNumber: integer('line_number').notNull(),
    batchIndex: integer('batch_index').notNull().default(0),
    ingestionId: uuid('ingestion_id').notNull().unique(),
    eventKey: identityBytes('event_key'),
    state: text('state').notNull().default('in_flight'),
    outcome: text('outcome'),
    reasonCode: text('reason_code'),
    httpStatus: integer('http_status'),
    diagnosticDocument: originalJson('diagnostic_document'),
    startedAt: technicalTime('started_at').notNull().defaultNow(),
    finalizedAt: technicalTime('finalized_at'),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.lineNumber] }),
    check(
      'replay_attempts_line_valid',
      sql`${table.lineNumber} BETWEEN 1 AND 24 AND ${table.batchIndex} = 0`,
    ),
    check(
      'replay_attempts_identity_valid',
      sql`${table.eventKey} IS NULL OR nexo_identity_is_canonical(${table.eventKey})`,
    ),
    check(
      'replay_attempts_http_valid',
      sql`${table.httpStatus} IS NULL OR ${table.httpStatus} BETWEEN 100 AND 599`,
    ),
    check(
      'replay_attempts_reason_valid',
      sql`${table.reasonCode} IS NULL OR ${table.reasonCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      'replay_attempts_time_valid',
      sql`${table.finalizedAt} IS NULL OR ${table.finalizedAt} >= ${table.startedAt}`,
    ),
    check(
      'replay_attempts_diagnostic_valid',
      sql`
      ${table.diagnosticDocument} IS NULL OR (json_typeof(${table.diagnosticDocument}) = 'object'
        AND octet_length(${table.diagnosticDocument}::text) <= 4096)
    `,
    ),
    check(
      'replay_attempts_result_valid',
      sql`
      (${table.state} = 'in_flight' AND ${table.outcome} IS NULL AND ${table.reasonCode} IS NULL
        AND ${table.httpStatus} IS NULL AND ${table.diagnosticDocument} IS NULL AND ${table.finalizedAt} IS NULL)
      OR (${table.state} = 'classified' AND ${table.outcome} IS NOT NULL AND ${table.httpStatus} = 200
        AND ${table.httpStatus} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL AND (
          (${table.outcome} IN ('accepted','duplicate') AND ${table.reasonCode} IS NULL)
          OR (${table.outcome} = 'rejected' AND ${table.reasonCode} IS NOT NULL)))
      OR (${table.state} IN ('uncertain','technical_failure') AND ${table.outcome} IS NULL
        AND ${table.reasonCode} IS NULL AND ${table.diagnosticDocument} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL)
    `,
    ),
    uniqueIndex('replay_attempts_one_in_flight')
      .on(table.runId)
      .where(sql`${table.state} = 'in_flight'`),
  ],
);
