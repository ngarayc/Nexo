import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';
import { RuntimeModule } from '../runtime/runtime.module.js';

@Module({
  imports: [RuntimeModule],
  providers: [DatabaseService],
  controllers: [HealthController],
  exports: [DatabaseService],
})
export class DatabaseModule {}
