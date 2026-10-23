ALTER TABLE "users" DROP CONSTRAINT "users_demo_only";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_demo_only" CHECK ("users"."username" IN ('demo', 'Demo'));