import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';

@Module({
  providers: [DatabaseService],
  controllers: [HealthController],
  exports: [DatabaseService],
})
export class DatabaseModule {}
