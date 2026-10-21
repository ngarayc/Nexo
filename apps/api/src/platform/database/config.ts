import type { PoolConfig } from 'pg';

export interface DatabaseConfig {
  readonly pool: PoolConfig & {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  readonly demoEnabled: boolean;
  readonly migrationsFolder: string;
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv, migration = false): DatabaseConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Falta configuración: ${name}.`);
    return value;
  };
  const password = required(migration ? 'DB_OWNER_PASSWORD' : 'DB_PASSWORD');
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Credencial de base inválida.');
  const demo = required('DEMO_ENABLED');
  if (demo !== 'true' && demo !== 'false') throw new Error('DEMO_ENABLED debe ser true o false.');
  for (const name of ['SESSION_SECRET', 'INGEST_API_KEY']) {
    if (!/^[a-f0-9]{64}$/.test(required(name))) throw new Error(`Configuración inválida: ${name}.`);
  }
  if (env['SESSION_SECRET'] === env['INGEST_API_KEY']) {
    throw new Error('Las credenciales técnicas deben ser independientes.');
  }
  const host = required('DB_HOST');
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new Error('DB_HOST inválido.');
  if (required('DB_NAME') !== 'nexo') throw new Error('DB_NAME debe ser nexo.');
  return {
    pool: {
      host,
      port: 5432,
      database: 'nexo',
      user: migration ? 'nexo_owner' : 'nexo_app',
      password,
      max: migration ? 1 : 6,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      query_timeout: 6000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 10000,
      application_name: migration ? 'nexo-migrations' : 'nexo-api',
    },
    demoEnabled: demo === 'true',
    migrationsFolder: new URL('../../../migrations/', import.meta.url).pathname,
  };
}
