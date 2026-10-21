import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ApplicationInfoService } from './application-info.service.js';
import { DatabaseModule } from './platform/database/database.module.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AppController],
  providers: [ApplicationInfoService],
})
export class AppModule {}
