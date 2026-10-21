ALTER TABLE "ingestion_items" DROP CONSTRAINT "ingestion_items_state_consistent";--> statement-breakpoint
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_state_consistent" CHECK (
    ("ingestion_items"."state" = 'waiting' AND "ingestion_items"."generation" = 0 AND "ingestion_items"."job_id" IS NULL AND "ingestion_items"."not_before" IS NULL AND "ingestion_items"."finalized_at" IS NULL AND "ingestion_items"."failure_code" IS NULL)
    OR ("ingestion_items"."state" = 'scheduled' AND "ingestion_items"."generation" > 0 AND "ingestion_items"."job_id" IS NOT NULL AND "ingestion_items"."not_before" IS NOT NULL AND "ingestion_items"."finalized_at" IS NULL)
    OR ("ingestion_items"."state" = 'classified' AND "ingestion_items"."generation" > 0 AND "ingestion_items"."job_id" IS NOT NULL AND "ingestion_items"."not_before" IS NOT NULL AND "ingestion_items"."finalized_at" IS NOT NULL)
    OR ("ingestion_items"."state" = 'failed' AND (
      "ingestion_items"."opportunities_reserved" = "ingestion_items"."attempt_limit"
      OR "ingestion_items"."failure_code" IN ('QUEUE_CANCELLED','QUEUE_PROTOCOL_VIOLATION','SCHEMA_INCOMPATIBLE','INGESTION_INVARIANT')
    ) AND "ingestion_items"."generation" > 0 AND "ingestion_items"."job_id" IS NOT NULL AND "ingestion_items"."not_before" IS NOT NULL AND "ingestion_items"."finalized_at" IS NOT NULL AND "ingestion_items"."failure_code" IS NOT NULL)
    OR ("ingestion_items"."state" = 'blocked' AND "ingestion_items"."generation" = 0 AND "ingestion_items"."job_id" IS NULL AND "ingestion_items"."not_before" IS NULL AND "ingestion_items"."finalized_at" IS NOT NULL AND "ingestion_items"."failure_code" IS NOT NULL)
  );