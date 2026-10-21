import { hash, verify, needsRehash, argon2id } from 'argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { DatabaseConfig } from './config.js';
import { users } from './schema.js';

const hashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  version: 0x13,
} as const;

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
      await client.query('GRANT USAGE ON SCHEMA public, drizzle TO nexo_app');
      await client.query('GRANT SELECT ON public.users, drizzle.__drizzle_migrations TO nexo_app');
    } finally {
      await client.query('SELECT pg_advisory_unlock(72416001)').catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}
