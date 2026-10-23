import type { PoolClient } from 'pg';

// Capacidad cerrada del modo demo: sin SQL dinámico, sin tocar usuarios,
// migraciones o secretos y sin dar TRUNCATE/DDL al proceso HTTP.
export async function prepareDemoReset(client: PoolClient, enabled: boolean): Promise<void> {
  await client.query('BEGIN');
  try {
    if (!enabled) {
      await client.query('DROP FUNCTION IF EXISTS public.clear_demo_data()');
    } else {
      await client.query(`CREATE OR REPLACE FUNCTION public.clear_demo_data() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $body$
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(72416004);
      IF EXISTS (SELECT 1 FROM public.ingestion_batches WHERE state='active')
        OR EXISTS (SELECT 1 FROM public.replay_runs
          WHERE state IN ('preparing','running','pausing','paused','restarting','finalizing'))
      THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DEMO_BUSY'; END IF;
      DELETE FROM pgboss.job WHERE name='telemetry.ingest';
      TRUNCATE TABLE public.replay_attempts, public.replay_runs,
        public.outbox_messages, public.alerts, public.vehicle_latest,
        public.ingestion_items, public.ingestion_batches, public.telemetry_events
        RESTART IDENTITY RESTRICT;
    END
    $body$`);
      await client.query('REVOKE ALL ON FUNCTION public.clear_demo_data() FROM PUBLIC');
      await client.query('GRANT EXECUTE ON FUNCTION public.clear_demo_data() TO nexo_app');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
