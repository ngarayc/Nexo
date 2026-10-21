-- Funciones y garantías manuales que el generador ORM no representa.
CREATE FUNCTION public.nexo_identity_is_canonical(value bytea) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, public AS $nexo$
DECLARE position integer; point integer; previous integer := -1; size integer := octet_length(value);
BEGIN
  IF size = 0 OR size % 4 <> 0 THEN RETURN false; END IF;
  FOR position IN 0..(size / 4 - 1) LOOP
    IF get_byte(value, position * 4) <> 0 THEN RETURN false; END IF;
    point := get_byte(value, position * 4 + 1) * 65536
      + get_byte(value, position * 4 + 2) * 256 + get_byte(value, position * 4 + 3);
    IF point > 1114111 OR (previous BETWEEN 55296 AND 56319 AND point BETWEEN 56320 AND 57343) THEN RETURN false; END IF;
    previous := point;
  END LOOP;
  RETURN true;
END;
$nexo$;
--> statement-breakpoint
CREATE TABLE "alerts" (
	"event_pk" bigint PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "alerts_type_valid" CHECK ("alerts"."type" = 'OVERSPEED')
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"ingestion_id" uuid PRIMARY KEY NOT NULL,
	"request_document" json NOT NULL,
	"total" integer NOT NULL,
	"input_bytes" bigint NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"next_index" integer DEFAULT 0 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_index" integer,
	"failure_code" text,
	CONSTRAINT "ingestion_batches_total_valid" CHECK ("ingestion_batches"."total" BETWEEN 1 AND 1000),
	CONSTRAINT "ingestion_batches_input_bytes_positive" CHECK ("ingestion_batches"."input_bytes" > 0),
	CONSTRAINT "ingestion_batches_revision_valid" CHECK ("ingestion_batches"."revision" >= 0),
	CONSTRAINT "ingestion_batches_cursor_valid" CHECK ("ingestion_batches"."next_index" BETWEEN 0 AND "ingestion_batches"."total"),
	CONSTRAINT "ingestion_batches_failure_code_valid" CHECK ("ingestion_batches"."failure_code" IS NULL OR "ingestion_batches"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "ingestion_batches_state_consistent" CHECK (
    ("ingestion_batches"."state" = 'active' AND "ingestion_batches"."next_index" < "ingestion_batches"."total" AND "ingestion_batches"."failed_index" IS NULL AND "ingestion_batches"."failure_code" IS NULL)
    OR ("ingestion_batches"."state" = 'complete' AND "ingestion_batches"."next_index" = "ingestion_batches"."total" AND "ingestion_batches"."failed_index" IS NULL AND "ingestion_batches"."failure_code" IS NULL)
    OR ("ingestion_batches"."state" = 'failed' AND "ingestion_batches"."next_index" < "ingestion_batches"."total" AND "ingestion_batches"."failed_index" = "ingestion_batches"."next_index" AND "ingestion_batches"."failed_index" IS NOT NULL AND "ingestion_batches"."failure_code" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "ingestion_items" (
	"ingestion_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"input_document" json NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"outcome" text,
	"reason_code" text,
	"resolved_event_pk" bigint,
	"generation" integer DEFAULT 0 NOT NULL,
	"opportunities_reserved" integer DEFAULT 0 NOT NULL,
	"attempt_limit" integer DEFAULT 3 NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"job_id" uuid,
	"not_before" timestamp with time zone,
	"failure_code" text,
	"last_failure_generation" integer,
	"last_failure_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "ingestion_items_ingestion_id_item_index_pk" PRIMARY KEY("ingestion_id","item_index"),
	CONSTRAINT "ingestion_items_index_valid" CHECK ("ingestion_items"."item_index" BETWEEN 0 AND 999),
	CONSTRAINT "ingestion_items_budget_valid" CHECK ("ingestion_items"."attempt_limit" > 0 AND "ingestion_items"."policy_version" > 0 AND "ingestion_items"."opportunities_reserved" BETWEEN 0 AND "ingestion_items"."attempt_limit" AND "ingestion_items"."generation" = "ingestion_items"."opportunities_reserved"),
	CONSTRAINT "ingestion_items_reason_valid" CHECK ("ingestion_items"."reason_code" IS NULL OR "ingestion_items"."reason_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "ingestion_items_failure_code_valid" CHECK ("ingestion_items"."failure_code" IS NULL OR "ingestion_items"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "ingestion_items_result_consistent" CHECK (
    ("ingestion_items"."state" = 'classified' AND "ingestion_items"."outcome" IS NOT NULL AND (
      ("ingestion_items"."outcome" IN ('accepted', 'duplicate') AND "ingestion_items"."outcome" IS NOT NULL AND "ingestion_items"."resolved_event_pk" IS NOT NULL AND "ingestion_items"."reason_code" IS NULL)
      OR ("ingestion_items"."outcome" = 'rejected' AND "ingestion_items"."resolved_event_pk" IS NULL AND "ingestion_items"."reason_code" IS NOT NULL)
    )) OR ("ingestion_items"."state" <> 'classified' AND "ingestion_items"."outcome" IS NULL AND "ingestion_items"."reason_code" IS NULL AND "ingestion_items"."resolved_event_pk" IS NULL)
  ),
	CONSTRAINT "ingestion_items_state_consistent" CHECK (
    ("ingestion_items"."state" = 'waiting' AND "ingestion_items"."generation" = 0 AND "ingestion_items"."job_id" IS NULL AND "ingestion_items"."not_before" IS NULL AND "ingestion_items"."finalized_at" IS NULL AND "ingestion_items"."failure_code" IS NULL)
    OR ("ingestion_items"."state" = 'scheduled' AND "ingestion_items"."generation" > 0 AND "ingestion_items"."job_id" IS NOT NULL AND "ingestion_items"."not_before" IS NOT NULL AND "ingestion_items"."finalized_at" IS NULL)
    OR ("ingestion_items"."state" = 'classified' AND "ingestion_items"."generation" > 0 AND "ingestion_items"."job_id" IS NOT NULL AND "ingestion_items"."not_before" IS NOT NULL AND "ingestion_items"."finalized_at" IS NOT NULL)
    OR ("ingestion_items"."state" = 'failed' AND "ingestion_items"."opportunities_reserved" = "ingestion_items"."attempt_limit" AND "ingestion_items"."job_id" IS NOT NULL AND "ingestion_items"."not_before" IS NOT NULL AND "ingestion_items"."finalized_at" IS NOT NULL AND "ingestion_items"."failure_code" IS NOT NULL)
    OR ("ingestion_items"."state" = 'blocked' AND "ingestion_items"."generation" = 0 AND "ingestion_items"."job_id" IS NULL AND "ingestion_items"."not_before" IS NULL AND "ingestion_items"."finalized_at" IS NOT NULL AND "ingestion_items"."failure_code" IS NOT NULL)
  ),
	CONSTRAINT "ingestion_items_failure_metadata_consistent" CHECK (
    ("ingestion_items"."state" = 'blocked' AND "ingestion_items"."last_failure_generation" IS NULL AND "ingestion_items"."last_failure_at" IS NULL)
    OR ("ingestion_items"."state" <> 'blocked' AND (
      ("ingestion_items"."failure_code" IS NULL AND "ingestion_items"."last_failure_generation" IS NULL AND "ingestion_items"."last_failure_at" IS NULL)
      OR ("ingestion_items"."failure_code" IS NOT NULL AND "ingestion_items"."last_failure_generation" IS NOT NULL AND "ingestion_items"."last_failure_generation" BETWEEN 1 AND "ingestion_items"."generation" AND "ingestion_items"."last_failure_at" IS NOT NULL)
    ))
  )
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"event_pk" bigint NOT NULL,
	"type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" json NOT NULL,
	"frame_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	CONSTRAINT "outbox_messages_type_valid" CHECK ("outbox_messages"."type" IN ('telemetry.accepted', 'vehicle.updated', 'alert.created')),
	CONSTRAINT "outbox_messages_shape_valid" CHECK ("outbox_messages"."schema_version" > 0 AND "outbox_messages"."frame_bytes" > 0 AND "outbox_messages"."attempts" >= 0),
	CONSTRAINT "outbox_messages_error_valid" CHECK ("outbox_messages"."last_error_code" IS NULL OR "outbox_messages"."last_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"event_pk" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telemetry_events_event_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_key" "bytea" NOT NULL,
	"vehicle_key" "bytea" NOT NULL,
	"observed_at_original" text NOT NULL,
	"observed_epoch_second" bigint NOT NULL,
	"observed_fraction" text COLLATE "C" NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"speed_kph" double precision NOT NULL,
	"ignition_on" boolean NOT NULL,
	"payload_extra" json NOT NULL,
	CONSTRAINT "telemetry_events_event_key_canonical" CHECK (nexo_identity_is_canonical("telemetry_events"."event_key")),
	CONSTRAINT "telemetry_events_vehicle_key_canonical" CHECK (nexo_identity_is_canonical("telemetry_events"."vehicle_key")),
	CONSTRAINT "telemetry_events_observed_original_present" CHECK (length("telemetry_events"."observed_at_original") > 0),
	CONSTRAINT "telemetry_events_fraction_canonical" CHECK ("telemetry_events"."observed_fraction" ~ '^(|[0-9]*[1-9])$'),
	CONSTRAINT "telemetry_events_latitude_valid" CHECK ("telemetry_events"."latitude" BETWEEN -90 AND 90 AND "telemetry_events"."latitude" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "telemetry_events_longitude_valid" CHECK ("telemetry_events"."longitude" BETWEEN -180 AND 180 AND "telemetry_events"."longitude" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)),
	CONSTRAINT "telemetry_events_speed_valid" CHECK ("telemetry_events"."speed_kph" >= 0 AND "telemetry_events"."speed_kph" NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))
);
--> statement-breakpoint
CREATE TABLE "vehicle_latest" (
	"vehicle_pk" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_latest_vehicle_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_key" "bytea" NOT NULL,
	"event_pk" bigint NOT NULL,
	CONSTRAINT "vehicle_latest_key_canonical" CHECK (nexo_identity_is_canonical("vehicle_latest"."vehicle_key"))
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_event_pk_telemetry_events_event_pk_fk" FOREIGN KEY ("event_pk") REFERENCES "public"."telemetry_events"("event_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_ingestion_id_ingestion_batches_ingestion_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."ingestion_batches"("ingestion_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_resolved_event_pk_telemetry_events_event_pk_fk" FOREIGN KEY ("resolved_event_pk") REFERENCES "public"."telemetry_events"("event_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_event_pk_telemetry_events_event_pk_fk" FOREIGN KEY ("event_pk") REFERENCES "public"."telemetry_events"("event_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_latest" ADD CONSTRAINT "vehicle_latest_event_pk_telemetry_events_event_pk_fk" FOREIGN KEY ("event_pk") REFERENCES "public"."telemetry_events"("event_pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_batches_active_cursor" ON "ingestion_batches" USING btree ("received_at","ingestion_id") WHERE "ingestion_batches"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_items_one_scheduled_per_batch" ON "ingestion_items" USING btree ("ingestion_id") WHERE "ingestion_items"."state" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_messages_event_type_unique" ON "outbox_messages" USING btree ("event_pk","type");--> statement-breakpoint
CREATE INDEX "outbox_messages_unpublished" ON "outbox_messages" USING btree ("available_at","created_at","message_id") WHERE "outbox_messages"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "telemetry_events_vehicle_key_hash" ON "telemetry_events" USING hash ("vehicle_key");
--> statement-breakpoint
ALTER TABLE public.telemetry_events ADD CONSTRAINT telemetry_events_event_key_unique EXCLUDE USING hash (event_key WITH =) NOT DEFERRABLE;
--> statement-breakpoint
ALTER TABLE public.vehicle_latest ADD CONSTRAINT vehicle_latest_vehicle_key_unique EXCLUDE USING hash (vehicle_key WITH =) NOT DEFERRABLE;
--> statement-breakpoint
CREATE FUNCTION public.nexo_preserve_telemetry_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $nexo$
BEGIN
  RAISE EXCEPTION 'Los eventos aceptados son inmutables.' USING ERRCODE = '23514';
END;
$nexo$;
--> statement-breakpoint
CREATE TRIGGER telemetry_events_immutable BEFORE UPDATE ON public.telemetry_events
FOR EACH ROW EXECUTE FUNCTION public.nexo_preserve_telemetry_event();
--> statement-breakpoint
CREATE FUNCTION public.nexo_validate_latest_vehicle() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $nexo$
DECLARE expected bytea;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.vehicle_key IS DISTINCT FROM OLD.vehicle_key THEN
    RAISE EXCEPTION 'La identidad del vehículo no cambia.' USING ERRCODE = '23514';
  END IF;
  -- El evento no puede mutarse/borrarse por el runtime; la FK adquiere su bloqueo.
  SELECT vehicle_key INTO expected FROM public.telemetry_events WHERE event_pk = NEW.event_pk;
  IF NOT FOUND THEN RAISE EXCEPTION 'El evento referenciado debe existir.' USING ERRCODE = '23503'; END IF;
  IF expected IS DISTINCT FROM NEW.vehicle_key THEN
    RAISE EXCEPTION 'La proyección debe referenciar el mismo vehículo.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$nexo$;
--> statement-breakpoint
CREATE TRIGGER vehicle_latest_same_vehicle BEFORE INSERT OR UPDATE ON public.vehicle_latest
FOR EACH ROW EXECUTE FUNCTION public.nexo_validate_latest_vehicle();
--> statement-breakpoint
CREATE FUNCTION public.nexo_preserve_ingestion_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $nexo$
BEGIN
  IF OLD.state <> 'active' THEN RAISE EXCEPTION 'El recibo finalizado es inmutable.' USING ERRCODE = '23514'; END IF;
  IF NEW.ingestion_id IS DISTINCT FROM OLD.ingestion_id OR NEW.request_document::text IS DISTINCT FROM OLD.request_document::text
    OR NEW.total IS DISTINCT FROM OLD.total OR NEW.input_bytes IS DISTINCT FROM OLD.input_bytes
    OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'La evidencia admitida es inmutable.' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <= OLD.revision OR NEW.next_index < OLD.next_index THEN
    RAISE EXCEPTION 'La revisión y el cursor no retroceden.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$nexo$;
--> statement-breakpoint
CREATE TRIGGER ingestion_batches_immutable_input BEFORE UPDATE ON public.ingestion_batches
FOR EACH ROW EXECUTE FUNCTION public.nexo_preserve_ingestion_batch();
--> statement-breakpoint
CREATE FUNCTION public.nexo_preserve_ingestion_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $nexo$
BEGIN
  IF OLD.state IN ('classified','failed','blocked') THEN
    RAISE EXCEPTION 'El resultado final es inmutable.' USING ERRCODE = '23514';
  END IF;
  IF NEW.ingestion_id IS DISTINCT FROM OLD.ingestion_id OR NEW.item_index IS DISTINCT FROM OLD.item_index
    OR NEW.input_document::text IS DISTINCT FROM OLD.input_document::text
    OR NEW.attempt_limit IS DISTINCT FROM OLD.attempt_limit OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'La posición y su política admitidas son inmutables.' USING ERRCODE = '23514';
  END IF;
  IF NEW.generation < OLD.generation OR NEW.opportunities_reserved < OLD.opportunities_reserved
    OR (OLD.not_before IS NOT NULL AND NEW.not_before < OLD.not_before) THEN
    RAISE EXCEPTION 'El presupuesto reservado no retrocede.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$nexo$;
--> statement-breakpoint
CREATE TRIGGER ingestion_items_immutable_input BEFORE UPDATE ON public.ingestion_items
FOR EACH ROW EXECUTE FUNCTION public.nexo_preserve_ingestion_item();
--> statement-breakpoint
CREATE FUNCTION public.nexo_preserve_outbox_effect() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $nexo$
BEGIN
  IF NEW.message_id IS DISTINCT FROM OLD.message_id OR NEW.event_pk IS DISTINCT FROM OLD.event_pk
    OR NEW.type IS DISTINCT FROM OLD.type OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.payload::text IS DISTINCT FROM OLD.payload::text OR NEW.frame_bytes IS DISTINCT FROM OLD.frame_bytes
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'La identidad y el contenido del efecto son inmutables.' USING ERRCODE = '23514';
  END IF;
  IF NEW.attempts < OLD.attempts OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'La publicación no retrocede.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$nexo$;
--> statement-breakpoint
CREATE TRIGGER outbox_messages_immutable_effect BEFORE UPDATE ON public.outbox_messages
FOR EACH ROW EXECUTE FUNCTION public.nexo_preserve_outbox_effect();
