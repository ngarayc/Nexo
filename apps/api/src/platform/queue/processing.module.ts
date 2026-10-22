import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { WriteDatabase } from '../database/write-database.js';
import { QueueConnection } from './connection.js';

// Recepción y demo consumen los mismos recursos; no se crea otro pool/broker.
@Module({
  imports: [DatabaseModule],
  providers: [WriteDatabase, QueueConnection],
  exports: [WriteDatabase, QueueConnection],
})
export class ProcessingModule {}
