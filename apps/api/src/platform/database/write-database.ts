import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseService } from './database.service.js';
import { DatabaseSlots } from './slots.js';

@Injectable()
export class WriteDatabase implements OnModuleDestroy {
  readonly pool: Pool;
  readonly controlSlots = new DatabaseSlots(1, 15);
  constructor(database: DatabaseService) {
    this.pool = new Pool({ ...database.config.pool, max: 6, application_name: 'nexo-writes' });
    this.pool.on('error', () => console.error('Conexión inactiva de escritura interrumpida.'));
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
