import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../../platform/database/database.service.js';
import type { WriteDatabase } from '../../platform/database/write-database.js';
import type { QueueConnection } from '../../platform/queue/connection.js';
import type { RuntimeHealth, RuntimeInstance } from '../../platform/runtime/runtime.module.js';
import type { Sessions } from '../access/public.js';
import type { StreamConnections } from '../realtime/public.js';
import { DemoRuntime } from './demo-runtime.js';

// Orquestación SSE con puertos sustituidos; las fronteras SQL/HTTP son integración.
const fakes = vi.hoisted(() => ({
  load: vi.fn(async () => ({ rows: [], hashes: {}, fixtureSha256: 'a'.repeat(64) })),
  software: vi.fn(async () => 'b'.repeat(64)),
  initialize: vi.fn(async () => {}),
  view: vi.fn<() => Promise<unknown>>(),
  close: vi.fn(),
  changed: undefined as undefined | (() => void),
  instances: [] as string[],
}));
vi.mock('./application/official-fixture.js', () => ({
  LoadOfficialFixture: class {
    readonly load = fakes.load;
  },
}));
vi.mock('./adapters/files/replay-software.js', () => ({
  loadReplaySoftwareFingerprint: fakes.software,
}));
vi.mock('./application/replay-coordinator.js', () => ({
  ReplayCoordinator: class {
    readonly initialize = fakes.initialize;
    readonly view = fakes.view;
    readonly close = fakes.close;
    constructor(
      _journal: unknown,
      _fixture: unknown,
      _producer: unknown,
      _verifier: unknown,
      _coordination: unknown,
      instanceId: string,
      changed: () => void,
    ) {
      fakes.instances.push(instanceId);
      fakes.changed = changed;
    }
  },
}));
describe('publicación compartida del control', () => {
  const runtimes: DemoRuntime[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.instances.length = 0;
    fakes.changed = undefined;
    vi.useFakeTimers();
    vi.stubEnv('PUBLIC_ORIGIN', 'http://localhost:8080');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('INGEST_API_KEY', '1'.repeat(64));
  });
  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) await runtime.onModuleDestroy();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  function setup(enabled = true, subscriberCount = 1) {
    const connections = { subscriberCount, broadcast: vi.fn() };
    const epoch = { id: 'stream-epoch-one' };
    const runtime = new DemoRuntime(
      {
        config: { pool: { host: 'db', port: 5432, database: 'nexo' } },
        migrationHash: 'c'.repeat(64),
      } as unknown as DatabaseService,
      {} as WriteDatabase,
      {} as QueueConnection,
      { healthy: true } as RuntimeHealth,
      epoch as RuntimeInstance,
      connections as unknown as StreamConnections,
      { demoEnabled: enabled } as Sessions,
    );
    runtimes.push(runtime);
    return { runtime, connections, epoch };
  }
  const frame = (revision: number) => ({
    instanceId: fakes.instances[0],
    viewRevision: revision,
    observedAt: new Date().toISOString(),
  });
  it('demo deshabilitada no carga material, no recupera ni publica', async () => {
    const { runtime, connections } = setup(false);
    await runtime.onModuleInit();
    runtime.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fakes.load).not.toHaveBeenCalled();
    expect(fakes.software).not.toHaveBeenCalled();
    expect(fakes.initialize).not.toHaveBeenCalled();
    expect(connections.broadcast).not.toHaveBeenCalled();
  });
  it('sin suscriptores no lee periódico; al conectarse usa una lectura compartida', async () => {
    const { runtime, connections } = setup(true, 0);
    await runtime.onModuleInit();
    runtime.onApplicationBootstrap();
    fakes.changed!();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fakes.view).not.toHaveBeenCalled();
    connections.subscriberCount = 16;
    fakes.view.mockResolvedValueOnce(frame(1));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fakes.view).toHaveBeenCalledTimes(1);
    expect(connections.broadcast).toHaveBeenCalledTimes(1);
    expect(connections.broadcast.mock.calls[0]![0]).toMatch(/^event:demo\.replay\.updated\ndata:/);
  });
  it('lectura fallida no vuelve a publicar el estado anterior con frescura nueva', async () => {
    const { runtime, connections } = setup();
    await runtime.onModuleInit();
    fakes.view.mockResolvedValueOnce(frame(1));
    runtime.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const original = connections.broadcast.mock.calls[0]![0];
    fakes.view.mockRejectedValueOnce(new Error('synthetic-read-unavailable'));
    fakes.changed!();
    await vi.advanceTimersByTimeAsync(0);
    expect(connections.broadcast).toHaveBeenCalledTimes(1);
    expect(connections.broadcast.mock.calls[0]![0]).toBe(original);
    fakes.view.mockResolvedValueOnce(frame(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(connections.broadcast).toHaveBeenCalledTimes(2);
    expect(connections.broadcast.mock.calls[1]![0]).toContain('"viewRevision":2');
  });
  it('cambio de época SSE conserva la instancia API; apagado impide publicaciones pendientes', async () => {
    const { runtime, connections, epoch } = setup();
    await runtime.onModuleInit();
    const instanceId = runtime.instanceId;
    fakes.view.mockResolvedValue(frame(1));
    runtime.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    epoch.id = 'stream-epoch-two';
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.instanceId).toBe(instanceId);
    expect(connections.broadcast.mock.calls[1]![0]).toContain(
      '"streamInstanceId":"stream-epoch-two"',
    );
    expect(connections.broadcast.mock.calls[1]![0]).toContain('"instanceId":"' + instanceId + '"');
    await runtime.onModuleDestroy();
    const count = connections.broadcast.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(connections.broadcast).toHaveBeenCalledTimes(count);
  });
});
