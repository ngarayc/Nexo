import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit, OnModuleDestroy, OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../../platform/database/database.service.js';
import { DatabaseSlots } from '../../platform/database/slots.js';
import { WriteDatabase } from '../../platform/database/write-database.js';
import { QueueConnection } from '../../platform/queue/connection.js';
import { RuntimeHealth, RuntimeInstance } from '../../platform/runtime/runtime.module.js';
import { readServerConfig } from '../../platform/config.js';
import { Sessions } from '../access/public.js';
import { StreamConnections, OutboxDispatcher } from '../realtime/public.js';
import { DemoMaintenance, DemoMaintenanceBusy } from '../../platform/runtime/demo-maintenance.js';
import { readIngestionLimits } from '../ingestion/public.js';
import { FileOfficialSources } from './adapters/files/official-sources.js';
import { loadReplaySoftwareFingerprint } from './adapters/files/replay-software.js';
import { LoopbackReplayProducer } from './adapters/http/replay-producer.js';
import { PostgresReplayEvidence } from './adapters/postgres/replay-evidence.js';
import { PostgresReplayJournal } from './adapters/postgres/journal.js';
import { ReplayAdmissionUnknown } from './application/admit-command.js';
import { LoadOfficialFixture } from './application/official-fixture.js';
import { ReplayCoordinator } from './application/replay-coordinator.js';
import { replayConfigurationFingerprint } from './application/replay-material.js';
import { VerifyOfficialReplay } from './application/verify-official.js';
import { readReplayUuid } from './domain/command.js';
import { ReplayConflict, terminalReplay, ReplayInputError } from './domain/replay.js';

@Injectable()
export class DemoRuntime implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  // Esta identidad nunca cambia por la resincronización del stream SSE.
  instanceId = randomUUID();
  private coordinator: ReplayCoordinator | undefined;
  private journal: PostgresReplayJournal | undefined;
  private verifier: VerifyOfficialReplay | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private publishing: Promise<void> | undefined;
  private dirty = false;
  private closed = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly write: WriteDatabase,
    private readonly queue: QueueConnection,
    private readonly health: RuntimeHealth,
    private readonly streamInstance: RuntimeInstance,
    private readonly connections: StreamConnections,
    private readonly sessions: Sessions,
    private readonly maintenance: DemoMaintenance = new DemoMaintenance(),
    private readonly outbox?: OutboxDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.sessions.demoEnabled) return;
    const server = readServerConfig(process.env);
    const fixture = await new LoadOfficialFixture(new FileOfficialSources()).load();
    const softwareFingerprint = await loadReplaySoftwareFingerprint();
    const configurationFingerprint = replayConfigurationFingerprint({
      database: this.database.config.pool,
      publicOrigin: process.env['PUBLIC_ORIGIN']!,
      demoEnabled: this.sessions.demoEnabled,
      ingestionLimits: readIngestionLimits(process.env),
      server,
    });
    this.journal = new PostgresReplayJournal(
      this.write.pool,
      this.database.pool,
      this.write.controlSlots,
      this.database.querySlots,
    );
    this.verifier = new VerifyOfficialReplay(
      fixture,
      new PostgresReplayEvidence(
        this.database.pool,
        this.database.querySlots,
        this.queue.boss,
        fixture,
        this.database.migrationHash,
        () => ({
          instanceId: this.instanceId,
          ready: !this.closed && this.health.healthy,
          softwareFingerprint,
          configurationFingerprint,
        }),
      ),
    );
    this.coordinator = new ReplayCoordinator(
      this.journal,
      fixture,
      new LoopbackReplayProducer(server.port, process.env['INGEST_API_KEY']!),
      this.verifier,
      // Exclusión del actor en memoria; el diario reserva el turno SQL
      // compartido con recuperación. No adquirir el mismo turno dos veces.
      new DatabaseSlots(1, 15),
      this.instanceId,
      () => this.wake(),
    );
    await this.coordinator.initialize();
  }
  onApplicationBootstrap(): void {
    if (!this.coordinator) return;
    this.timer = setInterval(() => this.wake(), 2000);
    this.timer.unref();
    this.wake();
  }
  async view() {
    if (!this.coordinator || this.maintenance.active) throw new ReplayAdmissionUnknown();
    return this.coordinator.view();
  }
  async command(value: unknown) {
    if (!this.coordinator || this.maintenance.active) throw new ReplayAdmissionUnknown();
    return this.coordinator.command(value);
  }
  async reset(value: unknown): Promise<{ cleared: true }> {
    if (typeof value !== 'object' || !value || Array.isArray(value)) throw new ReplayInputError();
    const input = value as Record<string, unknown>;
    if (
      Object.keys(input).length !== 3 ||
      input['confirmation'] !== 'CLEAR_DEMO' ||
      typeof input['instanceId'] !== 'string' ||
      !Number.isSafeInteger(input['expectedControlVersion'])
    )
      throw new ReplayInputError();
    if (!this.coordinator || !this.sessions.demoEnabled) throw new ReplayAdmissionUnknown();
    const release = this.maintenance.begin();
    let paused = false;
    let rebuild = false;
    try {
      const view = await this.coordinator.view();
      if (
        input['instanceId'] !== this.instanceId ||
        input['expectedControlVersion'] !== view.controlVersion
      )
        throw new ReplayConflict();
      if (view.pendingAction || (view.run && !terminalReplay(view.run.state)))
        throw new DemoMaintenanceBusy();
      await this.coordinator.whenIdle();
      await this.publishing;
      await this.outbox?.pause();
      paused = true;
      this.coordinator.close();
      rebuild = true;
      // Una sentencia/una transacción. El propietario solo expone esta función
      // fija; el HTTP conserva su usuario restringido y no recibe sus secretos.
      await this.write.controlSlots.run(() =>
        this.write.pool.query('SELECT public.clear_demo_data()', []),
      );
      return { cleared: true };
    } finally {
      try {
        if (rebuild) {
          // También ante una respuesta SQL perdida: invalidar el token anterior
          // y recuperar la verdad durable, sin repetir el borrado.
          this.instanceId = randomUUID();
          this.coordinator = undefined;
          await this.onModuleInit();
          this.streamInstance.renew();
          this.connections.closeAll();
        }
      } finally {
        if (paused) this.outbox?.resume();
        release();
        this.wake();
      }
    }
  }
  async receipt(commandId: string, instanceId: string) {
    if (!this.coordinator) throw new ReplayAdmissionUnknown();
    if (readReplayUuid(instanceId) !== this.instanceId) throw new ReplayConflict();
    const id = readReplayUuid(commandId);
    // Confirma la intención pendiente antes de describir un recibo conocido.
    await this.coordinator.view();
    return this.coordinator.admissions.receipts.get(id);
  }
  async detail(runId: string) {
    if (!this.journal) throw new ReplayAdmissionUnknown();
    return this.journal.find(readReplayUuid(runId));
  }
  async history(limit: number, cursor?: string) {
    if (!this.journal) throw new ReplayAdmissionUnknown();
    return this.journal.history(limit, cursor);
  }
  async inspect(runId: string) {
    if (!this.verifier) throw new ReplayAdmissionUnknown();
    return this.verifier.inspect(readReplayUuid(runId));
  }
  private wake(): void {
    if (
      this.closed ||
      this.maintenance.active ||
      !this.coordinator ||
      !this.connections.subscriberCount
    )
      return;
    this.dirty = true;
    if (this.publishing) return;
    this.publishing = this.publish().finally(() => {
      this.publishing = undefined;
      if (this.dirty && !this.closed) this.wake();
    });
  }
  private async publish(): Promise<void> {
    this.dirty = false;
    try {
      const view = await this.view();
      if (this.closed || !this.connections.subscriberCount) return;
      this.connections.broadcast(
        `event:demo.replay.updated\ndata:${JSON.stringify({
          type: 'demo.replay.updated',
          schemaVersion: 1,
          streamInstanceId: this.streamInstance.id,
          ...view,
        })}\n\n`,
      );
    } catch {
      // No emitir la última copia en caché con una fecha de verificación nueva.
      // La próxima pasada consulta de nuevo; no hay reenvío de telemetría.
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.coordinator?.close();
    await this.publishing;
  }
}
