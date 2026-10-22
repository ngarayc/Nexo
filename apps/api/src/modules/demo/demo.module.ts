import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { ProcessingModule } from '../../platform/queue/processing.module.js';
import { RuntimeModule } from '../../platform/runtime/runtime.module.js';
import { AccessModule } from '../access/public.js';
import { RealtimeModule } from '../realtime/public.js';
import { DemoRuntime } from './demo-runtime.js';
import { ReplayController } from './adapters/http/replay-controller.js';

@Module({
  imports: [DatabaseModule, ProcessingModule, RuntimeModule, AccessModule, RealtimeModule],
  providers: [DemoRuntime],
  controllers: [ReplayController],
})
export class DemoModule {}
