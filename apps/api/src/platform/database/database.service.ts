import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readDatabaseConfig } from './config.js';
import { DatabaseSlots } from './slots.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly config = readDatabaseConfig(process.env);
  readonly pool = new Pool({ ...this.config.pool, max: 4, application_name: 'nexo-queries' });
  readonly querySlots = new DatabaseSlots(16, 0);
  readonly db = drizzle(this.pool);
  private readonly migrations = readMigrationFiles({
    migrationsFolder: this.config.migrationsFolder,
  });

  constructor() {
    this.pool.on('error', () => console.error('Conexión inactiva de base interrumpida.'));
  }

  get migrationHash(): string {
    const hash = this.migrations.at(-1)?.hash;
    if (!hash) throw new Error('No hay migración verificable.');
    return hash;
  }

  async onModuleInit(): Promise<void> {
    if (!(await this.isHealthy())) throw new Error('Base o esquema no disponibles.');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.querySlots.run(() =>
        this.pool.query<{
          hash: string;
          count: string;
          valid: boolean;
        }>(`SELECT
        (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1) AS hash,
        (SELECT count(*) FROM public.users) AS count,
        (SELECT bool_and(username IN ('demo', 'Demo') AND password_hash LIKE '$argon2id$%') FROM public.users) AS valid`),
      );
      const current = result.rows[0];
      return (
        current?.hash === this.migrations.at(-1)?.hash &&
        (!this.config.demoEnabled || (current?.count === '1' && current.valid === true))
      );
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
