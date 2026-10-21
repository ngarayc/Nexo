import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ApplicationInfoService } from './application-info.service.js';

@Module({
  controllers: [AppController],
  providers: [ApplicationInfoService],
})
export class AppModule {}
