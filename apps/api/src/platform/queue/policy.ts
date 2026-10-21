import type { ConstructorOptions, Queue } from 'pg-boss';
import type { PoolConfig } from 'pg';
import type { DatabaseConfig } from '../database/config.js';

export const ingestionQueue = 'telemetry.ingest';
export const queueSettings = Object.freeze({
  retryLimit: 0,
  expireInSeconds: 30,
  retentionSeconds: 7 * 24 * 60 * 60,
  deleteAfterSeconds: 24 * 60 * 60,
  notify: true,
} satisfies Omit<Queue, 'name'>);
export const queuePolicy = Object.freeze({
  ...queueSettings,
  policy: 'standard',
  partition: false,
} satisfies Omit<Queue, 'name'>);

export function queueOptions(
  config: DatabaseConfig,
  preparing = false,
): ConstructorOptions & Pick<PoolConfig, 'query_timeout'> {
  return {
    host: config.pool.host,
    port: config.pool.port,
    database: config.pool.database,
    user: config.pool.user,
    password: config.pool.password,
    connectionTimeoutMillis: 2000,
    // 12.38.0 pasa esta configuración a pg.Pool; el límite cliente complementa el SQL.
    query_timeout: 6000,
    schema: 'pgboss',
    application_name: preparing ? 'nexo-queue-prepare' : 'nexo-queue',
    max: preparing ? 1 : 4,
    // Las sesiones internas requieren sus propios límites; no heredan los de Drizzle.
    options: '-c statement_timeout=5000 -c lock_timeout=1000',
    migrate: preparing,
    createSchema: preparing,
    supervise: !preparing,
    schedule: false,
    registerInstance: !preparing,
    useListenNotify: !preparing,
    superviseIntervalSeconds: 5,
    monitorIntervalSeconds: 5,
    maintenanceIntervalSeconds: 5,
  };
}
