import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { DatabaseService } from '../database/database.service.js';
import { queueOptions } from './policy.js';

@Injectable()
export class QueueConnection implements OnModuleInit, OnModuleDestroy {
  readonly boss: PgBoss;
  constructor(database: DatabaseService) {
    this.boss = new PgBoss(queueOptions(database.config));
    this.boss.on('error', () => console.error('Operación de la cola durable no disponible.'));
    this.boss.on('warning', () =>
      console.error('La cola durable informó una condición operativa.'),
    );
  }
  async onModuleInit(): Promise<void> {
    try {
      await this.boss.start();
    } catch (error) {
      await this.boss.stop({ graceful: false });
      throw error;
    }
  }
  async onModuleDestroy(): Promise<void> {
    await this.boss.stop({ timeout: 15000 });
  }
}
