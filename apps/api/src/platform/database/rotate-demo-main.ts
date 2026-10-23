import { hash } from 'argon2';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readDatabaseConfig } from './config.js';
import { readDemoCredentials } from './demo-credentials.js';
import { passwordHashOptions } from './password-policy.js';

// Operación administrativa explícita; no es un endpoint ni se ejecuta al arrancar.
async function rotate() {
  if (!process.env['DEMO_USERNAME'] || !process.env['DEMO_PASSWORD'])
    throw new Error('Falta la nueva credencial privada.');
  const credentials = readDemoCredentials(process.env);
  const config = readDatabaseConfig(process.env, true);
  const pool = new Pool(config.pool);
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(72416001)');
      await migrate(drizzle(client), { migrationsFolder: config.migrationsFolder });
      await client.query('BEGIN');
      const result = await client.query('SELECT id FROM public.users FOR UPDATE');
      if (result.rowCount !== 1) throw new Error('La rotación exige una cuenta existente.');
      const passwordHash = await hash(credentials.password, passwordHashOptions);
      await client.query(
        'UPDATE public.users SET username = $1, password_hash = $2 WHERE id = $3',
        [credentials.username, passwordHash, result.rows[0].id],
      );
      await client.query('COMMIT');
      console.log('Credenciales actualizadas; reinicia API para revocar las sesiones anteriores.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.query('SELECT pg_advisory_unlock(72416001)').catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}
rotate().catch(() => {
  console.error('No se confirmó la rotación de credenciales. Revisa la configuración privada.');
  process.exitCode = 1;
});
