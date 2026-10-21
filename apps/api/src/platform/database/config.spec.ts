import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readDatabaseConfig } from './config.js';

const valid = (): NodeJS.ProcessEnv => ({
  DB_HOST: 'db',
  DB_NAME: 'nexo',
  DB_PASSWORD: randomBytes(32).toString('hex'),
  DB_OWNER_PASSWORD: randomBytes(32).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  INGEST_API_KEY: randomBytes(32).toString('hex'),
  DEMO_ENABLED: 'true',
});

describe('configuración de persistencia', () => {
  it('separa propietario de migraciones y cuenta de ejecución', () => {
    const env = valid();
    const runtime = readDatabaseConfig(env);
    const migration = readDatabaseConfig(env, true);
    expect(runtime.pool.user).toBe('nexo_app');
    expect(migration.pool.user).toBe('nexo_owner');
    expect(runtime.pool.password).not.toBe(migration.pool.password);
    expect(runtime.pool.max).toBe(6);
    expect(runtime.migrationsFolder).toMatch(/apps\/api\/migrations\/$/);
  });

  for (const name of [
    'DB_HOST',
    'DB_NAME',
    'DB_PASSWORD',
    'SESSION_SECRET',
    'INGEST_API_KEY',
    'DEMO_ENABLED',
  ]) {
    it(`rechaza ${name} ausente sin imprimir valores`, () => {
      const env = valid();
      delete env[name];
      expect(() => readDatabaseConfig(env)).toThrow();
    });
  }

  it('rechaza secretos públicos de respaldo o reutilizados', () => {
    expect(() => readDatabaseConfig({ ...valid(), SESSION_SECRET: 'demo' })).toThrow();
    const env = valid();
    env['INGEST_API_KEY'] = env['SESSION_SECRET'];
    expect(() => readDatabaseConfig(env)).toThrow('independientes');
  });

  it('rechaza host, base y booleanos ambiguos', () => {
    for (const invalid of [
      { DB_HOST: 'db?password=secret' },
      { DB_NAME: 'postgres' },
      { DEMO_ENABLED: '1' },
    ]) {
      expect(() => readDatabaseConfig({ ...valid(), ...invalid })).toThrow();
    }
  });
});
