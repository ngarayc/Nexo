CREATE TABLE "replay_attempts" (
	"run_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"batch_index" integer DEFAULT 0 NOT NULL,
	"ingestion_id" uuid NOT NULL,
	"event_key" "bytea",
	"state" text DEFAULT 'in_flight' NOT NULL,
	"outcome" text,
	"reason_code" text,
	"http_status" integer,
	"diagnostic_document" json,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "replay_attempts_run_id_line_number_pk" PRIMARY KEY("run_id","line_number"),
	CONSTRAINT "replay_attempts_ingestion_id_unique" UNIQUE("ingestion_id"),
	CONSTRAINT "replay_attempts_line_valid" CHECK ("replay_attempts"."line_number" BETWEEN 1 AND 24 AND "replay_attempts"."batch_index" = 0),
	CONSTRAINT "replay_attempts_identity_valid" CHECK ("replay_attempts"."event_key" IS NULL OR nexo_identity_is_canonical("replay_attempts"."event_key")),
	CONSTRAINT "replay_attempts_http_valid" CHECK ("replay_attempts"."http_status" IS NULL OR "replay_attempts"."http_status" BETWEEN 100 AND 599),
	CONSTRAINT "replay_attempts_reason_valid" CHECK ("replay_attempts"."reason_code" IS NULL OR "replay_attempts"."reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "replay_attempts_time_valid" CHECK ("replay_attempts"."finalized_at" IS NULL OR "replay_attempts"."finalized_at" >= "replay_attempts"."started_at"),
	CONSTRAINT "replay_attempts_diagnostic_valid" CHECK (
      "replay_attempts"."diagnostic_document" IS NULL OR (json_typeof("replay_attempts"."diagnostic_document") = 'object'
        AND octet_length("replay_attempts"."diagnostic_document"::text) <= 4096)
    ),
	CONSTRAINT "replay_attempts_result_valid" CHECK (
      ("replay_attempts"."state" = 'in_flight' AND "replay_attempts"."outcome" IS NULL AND "replay_attempts"."reason_code" IS NULL
        AND "replay_attempts"."http_status" IS NULL AND "replay_attempts"."diagnostic_document" IS NULL AND "replay_attempts"."finalized_at" IS NULL)
      OR ("replay_attempts"."state" = 'classified' AND "replay_attempts"."outcome" IS NOT NULL AND "replay_attempts"."http_status" = 200
        AND "replay_attempts"."http_status" IS NOT NULL AND "replay_attempts"."finalized_at" IS NOT NULL AND (
          ("replay_attempts"."outcome" IN ('accepted','duplicate') AND "replay_attempts"."reason_code" IS NULL)
          OR ("replay_attempts"."outcome" = 'rejected' AND "replay_attempts"."reason_code" IS NOT NULL)))
      OR ("replay_attempts"."state" IN ('uncertain','technical_failure') AND "replay_attempts"."outcome" IS NULL
        AND "replay_attempts"."reason_code" IS NULL AND "replay_attempts"."diagnostic_document" IS NOT NULL AND "replay_attempts"."finalized_at" IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE TABLE "replay_runs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"scenario_id" uuid NOT NULL,
	"previous_run_id" uuid,
	"instance_id" uuid NOT NULL,
	"fixture_sha256" text NOT NULL,
	"stage" text NOT NULL,
	"interval_ms" integer DEFAULT 750 NOT NULL,
	"state" text DEFAULT 'preparing' NOT NULL,
	"next_line" integer DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"verification" text DEFAULT 'pending' NOT NULL,
	"verification_document" json,
	"scenario_verification" text DEFAULT 'pending' NOT NULL,
	"scenario_document" json,
	"scenario_closed_at" timestamp with time zone,
	"close_code" text,
	"last_command_id" uuid,
	"last_command_instance" uuid,
	"last_command_expected_version" bigint,
	"last_command_document" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replay_runs_fixture_valid" CHECK ("replay_runs"."fixture_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "replay_runs_interval_valid" CHECK ("replay_runs"."interval_ms" BETWEEN 100 AND 5000),
	CONSTRAINT "replay_runs_revision_valid" CHECK ("replay_runs"."revision" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "replay_runs_cursor_valid" CHECK ("replay_runs"."next_line" BETWEEN 1 AND 25),
	CONSTRAINT "replay_runs_time_valid" CHECK ("replay_runs"."updated_at" >= "replay_runs"."created_at"),
	CONSTRAINT "replay_runs_stage_valid" CHECK (
      ("replay_runs"."stage" = 'first' AND "replay_runs"."previous_run_id" IS NULL AND "replay_runs"."scenario_id" = "replay_runs"."run_id")
      OR ("replay_runs"."stage" IN ('second','exploratory') AND "replay_runs"."previous_run_id" IS NOT NULL
          AND "replay_runs"."previous_run_id" <> "replay_runs"."run_id" AND "replay_runs"."scenario_id" <> "replay_runs"."run_id")
    ),
	CONSTRAINT "replay_runs_state_valid" CHECK (
      ("replay_runs"."state" = 'preparing' AND "replay_runs"."next_line" = 1)
      OR ("replay_runs"."state" IN ('running','pausing','paused','restarting','finalizing') AND "replay_runs"."next_line" <= 24)
      OR ("replay_runs"."state" = 'completed' AND "replay_runs"."next_line" = 25)
      OR ("replay_runs"."state" IN ('stopped','error','interrupted') AND "replay_runs"."next_line" <= 24)
    ),
	CONSTRAINT "replay_runs_verification_valid" CHECK (
      ("replay_runs"."verification" = 'pending' AND "replay_runs"."verification_document" IS NULL
        AND "replay_runs"."state" NOT IN ('stopped','error','interrupted'))
      OR ("replay_runs"."verification" = 'inconclusive' AND "replay_runs"."state" IN ('completed','stopped','error','interrupted'))
      OR ("replay_runs"."verification" = 'conformant' AND "replay_runs"."verification_document" IS NOT NULL AND "replay_runs"."state" = 'completed')
      OR ("replay_runs"."verification" = 'non_conformant' AND "replay_runs"."verification_document" IS NOT NULL
        AND "replay_runs"."state" IN ('completed','stopped','error','interrupted'))
    ),
	CONSTRAINT "replay_runs_report_object" CHECK (
      "replay_runs"."verification_document" IS NULL OR json_typeof("replay_runs"."verification_document") = 'object'
    ),
	CONSTRAINT "replay_runs_scenario_result_valid" CHECK (
      ("replay_runs"."scenario_verification" = 'pending' AND "replay_runs"."scenario_document" IS NULL AND "replay_runs"."scenario_closed_at" IS NULL)
      OR ("replay_runs"."stage" = 'first' AND "replay_runs"."scenario_closed_at" IS NOT NULL AND "replay_runs"."scenario_closed_at" >= "replay_runs"."created_at"
        AND (("replay_runs"."scenario_verification" = 'inconclusive')
          OR ("replay_runs"."scenario_verification" IN ('conformant','non_conformant') AND "replay_runs"."scenario_document" IS NOT NULL))
        AND ("replay_runs"."scenario_document" IS NULL OR json_typeof("replay_runs"."scenario_document") = 'object'))
    ),
	CONSTRAINT "replay_runs_close_code_valid" CHECK (
      "replay_runs"."close_code" IS NULL OR "replay_runs"."close_code" IN ('TRANSPORT_UNCERTAIN','RESPONSE_PENDING',
      'RESPONSE_INVALID','JOURNAL_UNCERTAIN','NOT_ADMITTED','PROCESSING_FAILED','API_RESTARTED',
      'USER_RESTARTED','VERIFICATION_CLOSED')
    ),
	CONSTRAINT "replay_runs_intention_valid" CHECK (
      ("replay_runs"."last_command_id" IS NULL AND "replay_runs"."last_command_instance" IS NULL
        AND "replay_runs"."last_command_expected_version" IS NULL AND "replay_runs"."last_command_document" IS NULL)
      OR ("replay_runs"."last_command_id" IS NOT NULL AND "replay_runs"."last_command_instance" IS NOT NULL
        AND "replay_runs"."last_command_expected_version" IS NOT NULL AND "replay_runs"."last_command_document" IS NOT NULL
        AND "replay_runs"."last_command_expected_version" BETWEEN 0 AND 9007199254740990
        AND json_typeof("replay_runs"."last_command_document") = 'object'
        AND octet_length("replay_runs"."last_command_document"::text) <= 4096)
    )
);
--> statement-breakpoint
ALTER TABLE "replay_attempts" ADD CONSTRAINT "replay_attempts_run_id_replay_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."replay_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_runs" ADD CONSTRAINT "replay_runs_scenario_id_replay_runs_run_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."replay_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_runs" ADD CONSTRAINT "replay_runs_previous_run_id_replay_runs_run_id_fk" FOREIGN KEY ("previous_run_id") REFERENCES "public"."replay_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "replay_attempts_one_in_flight" ON "replay_attempts" USING btree ("run_id") WHERE "replay_attempts"."state" = 'in_flight';--> statement-breakpoint
CREATE UNIQUE INDEX "replay_runs_one_current" ON "replay_runs" USING btree ((true)) WHERE "replay_runs"."state" IN
      ('preparing','running','pausing','paused','restarting','finalizing');--> statement-breakpoint
CREATE UNIQUE INDEX "replay_runs_one_second" ON "replay_runs" USING btree ("scenario_id") WHERE "replay_runs"."stage" = 'second';--> statement-breakpoint
CREATE INDEX "replay_runs_history" ON "replay_runs" USING btree ("created_at" DESC NULLS LAST,"run_id" DESC NULLS LAST);
--> statement-breakpoint
-- Relaciones entre filas, transiciones e inmutabilidad no expresables mediante
-- CHECK/ORM. No se mantiene este bloqueo durante una petición de ingesta.
CREATE FUNCTION nexo_guard_replay_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous replay_runs%ROWTYPE; root replay_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Replay evidence is retained until local reset' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(72416003);
    IF (SELECT count(*) FROM replay_runs) >= 1000 THEN
      RAISE EXCEPTION 'Replay journal capacity reached' USING ERRCODE='23514', CONSTRAINT='replay_runs_capacity';
    END IF;
    IF NEW.state <> 'preparing' OR NEW.next_line <> 1 OR NEW.revision <> 0
      OR NEW.verification <> 'pending' OR NEW.scenario_verification <> 'pending' OR NEW.close_code IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid initial replay state' USING ERRCODE='23514';
    END IF;
    IF NEW.previous_run_id IS NOT NULL THEN
      SELECT * INTO previous FROM replay_runs WHERE run_id=NEW.previous_run_id FOR UPDATE;
      IF NOT FOUND OR previous.scenario_id <> NEW.scenario_id
        OR previous.fixture_sha256 <> NEW.fixture_sha256
        OR previous.state NOT IN ('completed','stopped','error','interrupted') THEN
        RAISE EXCEPTION 'Invalid prior replay' USING ERRCODE='23514';
      END IF;
      SELECT * INTO root FROM replay_runs WHERE run_id=NEW.scenario_id;
      IF NOT FOUND OR root.stage <> 'first' OR root.scenario_closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Scenario is unavailable or closed' USING ERRCODE='23514';
      END IF;
      IF NEW.stage='second' AND (previous.stage <> 'first' OR previous.state <> 'completed'
        OR previous.verification <> 'conformant') THEN
        RAISE EXCEPTION 'First replay must be completed and conformant' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.run_id,NEW.scenario_id,NEW.previous_run_id,NEW.instance_id,NEW.fixture_sha256,NEW.stage,NEW.created_at)
    IS DISTINCT FROM (OLD.run_id,OLD.scenario_id,OLD.previous_run_id,OLD.instance_id,OLD.fixture_sha256,OLD.stage,OLD.created_at)
    OR NEW.revision <> OLD.revision+1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Replay identity and revisions are protected' USING ERRCODE='23514';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state='preparing' AND NEW.state IN ('running','stopped','error','interrupted'))
    OR (OLD.state='running' AND NEW.state IN ('pausing','restarting','finalizing','completed','error','interrupted'))
    OR (OLD.state='pausing' AND NEW.state IN ('paused','completed','error','interrupted'))
    OR (OLD.state='paused' AND NEW.state IN ('running','restarting','finalizing','stopped','error','interrupted'))
    OR (OLD.state='restarting' AND NEW.state IN ('stopped','completed','error','interrupted'))
    OR (OLD.state='finalizing' AND NEW.state IN ('stopped','completed','error','interrupted'))
  ) THEN
    RAISE EXCEPTION 'Replay transition is not allowed' USING ERRCODE='23514';
  END IF;
  IF NEW.interval_ms <> OLD.interval_ms AND NOT (OLD.state='paused' AND NEW.state='running') THEN
    RAISE EXCEPTION 'Interval changes only on resume or a new run' USING ERRCODE='23514';
  END IF;
  IF OLD.verification <> 'pending' AND (NEW.verification,NEW.verification_document::text)
    IS DISTINCT FROM (OLD.verification,OLD.verification_document::text) THEN
    RAISE EXCEPTION 'Confirmed replay verification is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.scenario_verification <> 'pending' AND (NEW.scenario_verification,NEW.scenario_document::text,NEW.scenario_closed_at)
    IS DISTINCT FROM (OLD.scenario_verification,OLD.scenario_document::text,OLD.scenario_closed_at) THEN
    RAISE EXCEPTION 'Closed scenario verification is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER nexo_replay_run_guard BEFORE INSERT OR UPDATE OR DELETE ON replay_runs
FOR EACH ROW EXECUTE FUNCTION nexo_guard_replay_run();
--> statement-breakpoint
CREATE FUNCTION nexo_guard_replay_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent replay_runs%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Replay attempts are retained until local reset' USING ERRCODE='23514';
  END IF;
  SELECT * INTO parent FROM replay_runs WHERE run_id=NEW.run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay run not found' USING ERRCODE='23503';
  END IF;
  IF TG_OP='INSERT' THEN
    IF parent.state <> 'running' OR NEW.line_number <> parent.next_line OR NEW.state <> 'in_flight' THEN
      RAISE EXCEPTION 'Only the next running position can be dispatched' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.run_id,NEW.line_number,NEW.batch_index,NEW.ingestion_id,NEW.event_key,NEW.started_at)
    IS DISTINCT FROM (OLD.run_id,OLD.line_number,OLD.batch_index,OLD.ingestion_id,OLD.event_key,OLD.started_at)
    OR OLD.state <> 'in_flight' OR NEW.state NOT IN ('classified','uncertain','technical_failure') THEN
    RAISE EXCEPTION 'A finalized replay attempt cannot be rewritten' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER nexo_replay_attempt_guard BEFORE INSERT OR UPDATE OR DELETE ON replay_attempts
FOR EACH ROW EXECUTE FUNCTION nexo_guard_replay_attempt();
--> statement-breakpoint
-- Resultado/cursor se escriben juntos, pero pueden requerir varias sentencias.
-- La comprobación diferida exige su coherencia en el COMMIT real.
CREATE FUNCTION nexo_check_replay_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent replay_runs%ROWTYPE; classified_count integer; unresolved_count integer; inflight_count integer;
BEGIN
  SELECT * INTO parent FROM replay_runs WHERE run_id=NEW.run_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE state='classified'), count(*) FILTER (WHERE state <> 'classified'),
    count(*) FILTER (WHERE state='in_flight') INTO classified_count,unresolved_count,inflight_count
    FROM replay_attempts WHERE run_id=parent.run_id;
  IF classified_count <> parent.next_line-1 OR unresolved_count > 1
    OR EXISTS (SELECT 1 FROM replay_attempts WHERE run_id=parent.run_id AND (
      (state='classified' AND line_number >= parent.next_line)
      OR (state <> 'classified' AND line_number <> parent.next_line)))
    OR (inflight_count > 0 AND parent.state NOT IN ('running','pausing','restarting','finalizing'))
    OR (parent.state='preparing' AND unresolved_count > 0)
    OR (parent.state IN ('stopped','error','interrupted') AND parent.close_code IS NULL) THEN
    RAISE EXCEPTION 'Replay cursor and confirmed outcomes must commit together' USING ERRCODE='23514';
  END IF;
  IF parent.scenario_verification <> 'pending' AND (
    parent.state NOT IN ('completed','stopped','error','interrupted')
    OR EXISTS (SELECT 1 FROM replay_runs WHERE scenario_id=parent.run_id
      AND state IN ('preparing','running','pausing','paused','restarting','finalizing'))
  ) THEN
    RAISE EXCEPTION 'A closed scenario cannot retain an active emitter' USING ERRCODE='23514';
  END IF;
  IF parent.scenario_verification='conformant' AND (
    parent.verification <> 'conformant'
    OR NOT EXISTS (SELECT 1 FROM replay_runs WHERE scenario_id=parent.run_id AND stage='second'
      AND state='completed' AND verification='conformant')
    OR EXISTS (SELECT 1 FROM replay_runs WHERE scenario_id=parent.run_id AND stage='exploratory')
  ) THEN
    RAISE EXCEPTION 'Scenario conformance requires its two confirmed replays' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER nexo_replay_run_consistency AFTER INSERT OR UPDATE ON replay_runs
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nexo_check_replay_consistency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER nexo_replay_attempt_consistency AFTER INSERT OR UPDATE ON replay_attempts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nexo_check_replay_consistency();
