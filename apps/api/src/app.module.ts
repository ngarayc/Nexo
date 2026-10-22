import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ApplicationInfoService } from './application-info.service.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { AccessModule } from './modules/access/public.js';
import { IngestionModule } from './modules/ingestion/public.js';
import { QueriesModule } from './modules/queries/public.js';
import { RealtimeModule } from './modules/realtime/public.js';

@Module({
  imports: [DatabaseModule, AccessModule, IngestionModule, QueriesModule, RealtimeModule],
  controllers: [AppController],
  providers: [ApplicationInfoService],
})
export class AppModule {}
