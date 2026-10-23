import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module.js';
import { RuntimeModule, RuntimeInstance } from '../../platform/runtime/runtime.module.js';
import { AccessModule } from '../access/public.js';
import { OutboxReadiness } from './application/dispatch.js';
import { RealtimeAvailability } from './application/availability.js';
import { StreamConnections } from './adapters/http/stream-connections.js';
import { StreamController } from './adapters/http/stream-controller.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';

@Module({
  imports: [DatabaseModule, RuntimeModule, AccessModule],
  controllers: [StreamController],
  providers: [
    { provide: OutboxReadiness, useFactory: () => new OutboxReadiness() },
    {
      provide: RealtimeAvailability,
      inject: [OutboxReadiness, RuntimeInstance],
      useFactory: (readiness: OutboxReadiness, instance: RuntimeInstance) =>
        new RealtimeAvailability(readiness, () => instance.renew()),
    },
    StreamConnections,
    OutboxDispatcher,
  ],
  exports: [StreamConnections, OutboxDispatcher],
})
export class RealtimeModule {}
