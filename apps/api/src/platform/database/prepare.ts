import { hash, verify, needsRehash } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { DatabaseConfig } from './config.js';
import { users } from './schema.js';
import { passwordHashOptions as hashOptions } from './password-policy.js';
import { prepareQueue } from '../queue/prepare.js';

export async function prepareDatabase(config: DatabaseConfig): Promise<void> {
  const pool = new Pool(config.pool);
  try {
    const client = await pool.connect();
    try {
      // Un único preparador: migración, seed y permisos antes de aceptar tráfico.
      await client.query('SELECT pg_advisory_lock(72416001)');
      const priorSchema = await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.users') IS NOT NULL AS present",
      );
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: config.migrationsFolder });
      if (config.demoEnabled) {
        const existing = await db.select().from(users);
        if (existing.length === 0) {
          if (priorSchema.rows[0]?.present) {
            throw new Error('Cuenta demo ausente en una base inicializada.');
          }
          const passwordHash = await hash('demo', hashOptions);
          await db.insert(users).values({ username: 'demo', passwordHash });
        } else {
          const user = existing[0];
          if (
            existing.length !== 1 ||
            user?.username !== 'demo' ||
            !user.passwordHash.startsWith('$argon2id$') ||
            needsRehash(user.passwordHash, hashOptions) ||
            !(await verify(user.passwordHash, 'demo'))
          ) {
            throw new Error('Cuenta demo incompatible; no se sobrescribe.');
          }
        }
      }
      await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await client.query('REVOKE TEMPORARY ON DATABASE nexo FROM PUBLIC');
      await client.query('GRANT USAGE ON SCHEMA public, drizzle TO nexo_app');
      await client.query('GRANT SELECT ON public.users, drizzle.__drizzle_migrations TO nexo_app');
      await client.query(`GRANT SELECT, INSERT ON public.telemetry_events, public.vehicle_latest,
        public.alerts, public.ingestion_batches, public.ingestion_items, public.outbox_messages TO nexo_app`);
      await client.query('GRANT UPDATE (event_pk) ON public.vehicle_latest TO nexo_app');
      await client.query(
        'GRANT UPDATE ON public.ingestion_batches, public.ingestion_items TO nexo_app',
      );
      await client.query(`GRANT UPDATE (available_at, published_at, attempts, last_error_code)
        ON public.outbox_messages TO nexo_app`);
      await client.query(`GRANT USAGE, SELECT ON SEQUENCE public.telemetry_events_event_pk_seq,
        public.vehicle_latest_vehicle_pk_seq TO nexo_app`);
      await prepareQueue(config, client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(72416001)').catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}
