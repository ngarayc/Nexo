ALTER TABLE "replay_runs" ADD COLUMN "post_closure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "replay_runs" ADD CONSTRAINT "replay_runs_post_closure_valid" CHECK (NOT "replay_runs"."post_closure" OR ("replay_runs"."stage" = 'exploratory' AND "replay_runs"."previous_run_id" IS NOT NULL));
--> statement-breakpoint
-- Los informes de un escenario cerrado siguen inmutables. Solo se permite un
-- nuevo sufijo exploratorio; los recorridos oficiales no pueden reabrirse.
CREATE OR REPLACE FUNCTION nexo_guard_replay_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous replay_runs%ROWTYPE; root replay_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Replay evidence is retained until local reset' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Sufijo exploratorio derivado del estado SQL, nunca de un valor del cliente.
    NEW.post_closure := false;
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
      IF NOT FOUND OR root.stage <> 'first' OR (root.scenario_closed_at IS NOT NULL AND NEW.stage <> 'exploratory') THEN
        RAISE EXCEPTION 'Scenario is unavailable or closed' USING ERRCODE='23514';
      END IF;
      NEW.post_closure := root.scenario_closed_at IS NOT NULL;
      IF NEW.stage='second' AND (previous.stage <> 'first' OR previous.state <> 'completed'
        OR previous.verification <> 'conformant') THEN
        RAISE EXCEPTION 'First replay must be completed and conformant' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.run_id,NEW.scenario_id,NEW.previous_run_id,NEW.instance_id,NEW.fixture_sha256,NEW.stage,NEW.created_at,NEW.post_closure)
    IS DISTINCT FROM (OLD.run_id,OLD.scenario_id,OLD.previous_run_id,OLD.instance_id,OLD.fixture_sha256,OLD.stage,OLD.created_at,OLD.post_closure)
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
CREATE OR REPLACE FUNCTION nexo_check_replay_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR EXISTS (SELECT 1 FROM replay_runs WHERE scenario_id=parent.run_id AND NOT post_closure
      AND state IN ('preparing','running','pausing','paused','restarting','finalizing'))
  ) THEN
    RAISE EXCEPTION 'A closed scenario cannot retain an active emitter' USING ERRCODE='23514';
  END IF;
  IF parent.scenario_verification='conformant' AND (
    parent.verification <> 'conformant'
    OR NOT EXISTS (SELECT 1 FROM replay_runs WHERE scenario_id=parent.run_id AND stage='second'
      AND state='completed' AND verification='conformant')
    OR EXISTS (SELECT 1 FROM replay_runs WHERE scenario_id=parent.run_id AND stage='exploratory' AND NOT post_closure)
  ) THEN
    RAISE EXCEPTION 'Scenario conformance requires its two confirmed replays' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
