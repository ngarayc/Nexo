import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { Pool } from 'pg';
import { DatabaseService } from '../../platform/database/database.service.js';
import { CommittedChanges, RuntimeHealth } from '../../platform/runtime/runtime.module.js';
import { DispatchOutbox, OutboxReadiness } from './application/dispatch.js';
import { RealtimeAvailability } from './application/availability.js';
import { PostgresOutboxStore } from './adapters/postgres/outbox-store.js';
import { storedFrame } from './adapters/postgres/stored-frame.js';
import { StreamConnections } from './adapters/http/stream-connections.js';

@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly pool: Pool;
  private readonly dispatch: DispatchOutbox;
  private readonly abort = new AbortController();
  private readonly removeWake;
  private readonly removeHealth;
  private timer: ReturnType<typeof setInterval> | undefined;
  private supervisor: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private queued = false;
  private stopped = false;

  constructor(
    database: DatabaseService,
    connections: StreamConnections,
    private readonly readiness: OutboxReadiness,
    private readonly availability: RealtimeAvailability,
    committed: CommittedChanges,
    health: RuntimeHealth,
  ) {
    this.pool = new Pool({ ...database.config.pool, max: 1, application_name: 'nexo-outbox' });
    this.pool.on('error', () => {
      readiness.interrupt();
      void availability.healthy;
    });
    this.dispatch = new DispatchOutbox(
      new PostgresOutboxStore(this.pool),
      storedFrame,
      (frame) => connections.broadcast(frame),
      readiness,
    );
    this.removeWake = committed.subscribe(() => this.wake());
    this.removeHealth = health.register(() => availability.healthy);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.wake(), 250);
    this.supervisor = setInterval(() => {
      void this.availability.healthy;
    }, 1000);
    this.timer.unref();
    this.supervisor.unref();
    this.wake();
    // La salud permanece degradada hasta la primera revisión; no impedir que
    // ingesta/diagnóstico escuchen mientras se recupera un backlog anterior.
  }
  private wake(): void {
    if (this.stopped) return;
    this.queued = true;
    if (this.pending) return;
    this.pending = this.run().finally(() => {
      this.pending = undefined;
      if (this.queued && !this.stopped) this.wake();
    });
  }
  private async run(): Promise<void> {
    while (!this.stopped) {
      this.queued = false;
      let more: boolean;
      try {
        more = await this.dispatch.group(this.abort.signal);
        void this.availability.healthy;
      } catch {
        // El resultado no comprobable mantiene degradación. La siguiente pasada
        // vuelve a la verdad durable; nunca registra un error SQL o payload.
        void this.availability.healthy;
        return;
      }
      if (!more && !this.queued) return;
      await yieldLoop();
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    clearInterval(this.timer);
    clearInterval(this.supervisor);
    this.removeWake();
    this.readiness.interrupt();
    void this.availability.healthy;
    await this.pending;
    await this.pool.end();
    this.removeHealth();
  }
}
