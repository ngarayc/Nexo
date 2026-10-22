import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { expect, it, vi } from 'vitest';
import type { DomainSnapshot, DomainChange, EventView, ReplayStreamFrame } from '@nexo/contracts';
import { SessionState } from '../../platform/session/session-state';
import { SessionApi } from '../access/data-access/session-api';
import { TelemetryApi } from '../../platform/telemetry/telemetry-api';
import { STREAM_TRANSPORT, LIVE_CLOCK } from '../../platform/telemetry/stream-transport';
import type {
  LiveClock,
  StreamHandlers,
  StreamHandle,
  StreamTransport,
} from '../../platform/telemetry/stream-transport';
import { FleetFacade } from '../fleet/fleet-facade';
import { AlertsFacade } from '../alerts/alerts-facade';
import { LiveMonitor } from './live-monitor';

const instance = '00000000-0000-4000-8000-000000000001';
const event = (eventId = 'E-1', vehicleId = 'V-1'): EventView => ({
  eventId,
  vehicleId,
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph: 81,
  ignitionOn: true,
});
const change = (eventId = 'E-1', vehicleId = 'V-1'): DomainChange => ({
  messageId: 'message-' + eventId,
  schemaVersion: 1,
  type: 'vehicle.updated',
  eventId,
  vehicleId,
  observedAt: event().observedAt,
  data: { ...event(eventId, vehicleId), state: 'MOVING' },
});
const snapshot = (instanceId = instance): DomainSnapshot => ({
  schemaVersion: 1,
  instanceId,
  vehicles: { items: [], total: 0, overallTotal: 0, summary: { MOVING: 0, OFF: 0, STOPPED: 0 } },
  alerts: { items: [], total: 0, overallTotal: 0 },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Clock implements LiveClock {
  time = 0;
  wallTime = Date.now();
  tasks = new Map<symbol, { at: number; callback: () => void }>();
  now = () => this.time;
  wall = () => this.wallTime;
  random = () => 0;
  after(milliseconds: number, callback: () => void) {
    const id = Symbol();
    this.tasks.set(id, { at: this.time + milliseconds, callback });
    return () => {
      this.tasks.delete(id);
    };
  }
  advance(milliseconds: number) {
    const target = this.time + milliseconds;
    for (;;) {
      const next = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      this.wallTime += next[1].at - this.time;
      this.time = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    this.wallTime += target - this.time;
    this.time = target;
  }
}
class Source implements StreamHandle {
  open = false;
  closed = false;
  constructor(readonly handlers: StreamHandlers) {}
  close() {
    this.closed = true;
    this.open = false;
  }
  ready(id = instance) {
    this.open = true;
    this.handlers.control({
      type: 'stream.ready',
      schemaVersion: 1,
      instanceId: id,
      heartbeatMilliseconds: 15000,
    });
  }
  fail() {
    this.close();
    this.handlers.failed();
  }
  frame(value = change(), bytes = 100) {
    this.handlers.frame({ change: value, bytes });
  }
}
class Transport implements StreamTransport {
  sources: Source[] = [];
  resumes = new Set<() => void>();
  connect(handlers: StreamHandlers) {
    const source = new Source(handlers);
    this.sources.push(source);
    return source;
  }
  onResume(handler: () => void) {
    this.resumes.add(handler);
    return () => {
      this.resumes.delete(handler);
    };
  }
  resume() {
    for (const handler of this.resumes) handler();
  }
  get latest() {
    return this.sources.at(-1)!;
  }
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

it('replay comparte generación y valida época SSE sin confundirla con la instancia del motor', async () => {
  const { monitor, transport, requests } = setup();
  const listener = vi.fn();
  monitor.onReplay(listener);
  transport.latest.ready();
  requests[0]!.result.resolve(snapshot());
  await flush();
  const source = transport.latest;
  const frame: ReplayStreamFrame = {
    type: 'demo.replay.updated',
    schemaVersion: 1,
    streamInstanceId: instance,
    instanceId: '00000000-0000-4000-8000-000000000002',
    controlVersion: 0,
    viewRevision: 0,
    observedAt: new Date().toISOString(),
    allowedActions: ['start'],
    pendingAction: null,
    blockedReason: null,
    scenario: null,
    run: null,
  };
  source.handlers.replay!(frame);
  expect(listener).toHaveBeenCalledExactlyOnceWith(frame, monitor.currentGeneration);
  source.handlers.replay!({ ...frame, streamInstanceId: '00000000-0000-4000-8000-000000000003' });
  expect(source.closed).toBe(true);
  expect(monitor.phase()).toBe('reconnecting');
  source.handlers.replay!(frame);
  expect(listener).toHaveBeenCalledTimes(1);
});
function setup() {
  const clock = new Clock(),
    transport = new Transport();
  const requests: { signal: AbortSignal; result: ReturnType<typeof deferred<DomainSnapshot>> }[] =
    [];
  const api = {
    snapshot: vi.fn((signal: AbortSignal) => {
      const result = deferred<DomainSnapshot>();
      requests.push({ signal, result });
      return result.promise;
    }),
  };
  const session = {
    user: { id: 'demo-id', username: 'demo' as const },
    csrfToken: 'a'.repeat(256),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const access = { current: vi.fn(async () => session) };
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { navigateByUrl: vi.fn(async () => true) } },
      { provide: TelemetryApi, useValue: api },
      { provide: SessionApi, useValue: access },
      { provide: STREAM_TRANSPORT, useValue: transport },
      { provide: LIVE_CLOCK, useValue: clock },
    ],
  });
  const sessions = TestBed.inject(SessionState);
  sessions.accept(session, sessions.epoch);
  const monitor = TestBed.inject(LiveMonitor);
  TestBed.tick();
  return {
    clock,
    transport,
    requests,
    api,
    session,
    access,
    sessions,
    monitor,
    fleet: TestBed.inject(FleetFacade),
    alerts: TestBed.inject(AlertsFacade),
  };
}

it('espera ready, captura antes de HTTP e instala snapshot más cambios sin duplicar ni retroceder', async () => {
  const { monitor, transport, requests, api, fleet, alerts } = setup();
  expect(transport.sources.length).toBe(1);
  expect(api.snapshot).not.toHaveBeenCalled();
  expect(monitor.phase()).toBe('loading');
  expect(monitor.hasBase()).toBe(false);
  transport.latest.ready();
  transport.latest.frame(change('new'));
  transport.latest.frame(change('new'));
  requests[0]!.result.resolve(snapshot());
  await flush();
  expect(monitor.phase()).toBe('live');
  expect(monitor.hasBase()).toBe(true);
  expect(fleet.items().map((v) => v.eventId)).toEqual(['new']);
  expect(alerts.total()).toBe(0);
  transport.latest.frame(change('aaa-older'));
  expect(fleet.get('V-1')?.eventId).toBe('new');
  expect(TestBed.inject(LiveMonitor)).toBe(monitor);
  expect(transport.sources.length).toBe(1);
});
it('una respuesta de instancia distinta no instala ninguna colección ni confirma un vacío', async () => {
  const { monitor, transport, requests, fleet } = setup();
  transport.latest.ready();
  transport.latest.frame(change());
  requests[0]!.result.resolve(snapshot('other-instance'));
  await flush();
  expect(monitor.hasBase()).toBe(false);
  expect(monitor.phase()).toBe('loading');
  expect(fleet.total()).toBe(0);
  expect(transport.latest.closed).toBe(true);
});
it('reconectar cancela HTTP y descarta respuestas y callbacks de la generación anterior', async () => {
  const { monitor, transport, requests, fleet } = setup();
  const old = transport.latest;
  old.ready();
  monitor.reconnect();
  await flush();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(old.closed).toBe(true);
  transport.latest.ready();
  transport.latest.frame(change('current', 'current'));
  requests[1]!.result.resolve(snapshot());
  await flush();
  old.frame(change('obsolete', 'obsolete'));
  requests[0]!.result.resolve({
    ...snapshot(),
    vehicles: {
      items: [{ ...event('obsolete', 'obsolete'), status: 'MOVING' }],
      total: 1,
      overallTotal: 1,
      summary: { MOVING: 1, STOPPED: 0, OFF: 0 },
    },
  });
  await flush();
  expect(fleet.items().map((v) => v.vehicleId)).toEqual(['current']);
});
it('los cinco reintentos tienen un dueño y terminan en error hasta la acción manual', async () => {
  const { monitor, transport, clock, access } = setup();
  for (const delay of [2000, 4000, 8000, 16000, 30000]) {
    const count = transport.sources.length;
    transport.latest.fail();
    clock.advance(delay - 1);
    await flush();
    expect(transport.sources.length).toBe(count);
    clock.advance(1);
    await flush();
    expect(transport.sources.length).toBe(count + 1);
    expect(transport.sources.filter((s) => !s.closed).length).toBe(1);
  }
  transport.latest.fail();
  expect(monitor.phase()).toBe('error');
  clock.advance(60000);
  await flush();
  expect(transport.sources.length).toBe(6);
  expect(access.current).toHaveBeenCalledTimes(5);
  monitor.reconnect();
  await flush();
  expect(transport.sources.length).toBe(7);
  expect(monitor.phase()).toBe('loading');
});
it('ready expira a los 10 s y una conexión silenciosa a los 45 s', async () => {
  const { monitor, transport, clock, requests } = setup();
  const initial = transport.latest;
  clock.advance(9999);
  expect(initial.closed).toBe(false);
  clock.advance(1);
  expect(initial.closed).toBe(true);
  clock.advance(2000);
  await flush();
  transport.latest.ready();
  requests[0]!.result.resolve(snapshot());
  await flush();
  expect(monitor.phase()).toBe('live');
  clock.advance(44999);
  expect(monitor.phase()).toBe('live');
  clock.advance(1);
  expect(monitor.phase()).toBe('reconnecting');
  expect(monitor.hasBase()).toBe(true);
});
it('heartbeat conserva la salud sin fingir una nueva sincronización y 30 s sanos reinician el presupuesto', async () => {
  const { monitor, transport, requests, clock } = setup();
  transport.latest.fail();
  clock.advance(2000);
  await flush();
  transport.latest.ready();
  requests[0]!.result.resolve(snapshot());
  await flush();
  const synced = monitor.lastSynchronizedAt();
  clock.advance(15000);
  transport.latest.handlers.control({
    type: 'stream.heartbeat',
    schemaVersion: 1,
    instanceId: instance,
  });
  clock.advance(15000);
  expect(monitor.lastSynchronizedAt()).toBe(synced);
  transport.latest.fail();
  const count = transport.sources.length;
  clock.advance(2000);
  await flush();
  expect(transport.sources.length).toBe(count + 1);
});
it('al volver de suspensión detecta silencio aunque el reloj monotónico haya quedado detenido', async () => {
  const { monitor, transport, requests, clock } = setup();
  transport.latest.ready();
  requests[0]!.result.resolve(snapshot());
  await flush();
  clock.wallTime += 60000;
  transport.resume();
  expect(monitor.phase()).toBe('reconnecting');
  expect(transport.latest.closed).toBe(true);
});
it('un cambio de instancia y un control resync invalidan la captura pendiente', async () => {
  const { monitor, transport, requests } = setup();
  transport.latest.ready();
  transport.latest.handlers.control({
    type: 'stream.heartbeat',
    schemaVersion: 1,
    instanceId: 'other',
  });
  expect(requests[0]!.signal.aborted).toBe(true);
  monitor.reconnect();
  await flush();
  transport.latest.ready();
  transport.latest.handlers.control({
    type: 'stream.resync-required',
    reason: 'CLIENT_CAPACITY',
    schemaVersion: 1,
    instanceId: instance,
  });
  expect(requests[1]!.signal.aborted).toBe(true);
  expect(monitor.hasBase()).toBe(false);
});
it('dos capturas comparten 2 MiB y un desbordamiento invalida ambas y conserva base como desactualizada', async () => {
  const { monitor, transport, requests } = setup();
  transport.latest.ready();
  requests[0]!.result.resolve(snapshot());
  await flush();
  const a = monitor.capture((c) => c.vehicleId === 'A');
  const b = monitor.capture((c) => c.vehicleId === 'B');
  transport.latest.frame(change('a', 'A'), 1100000);
  transport.latest.frame(change('b', 'B'), 1100000);
  expect(monitor.phase()).toBe('reconnecting');
  expect(monitor.hasBase()).toBe(true);
  expect(a.active).toBe(false);
  expect(b.active).toBe(false);
  expect(() => a.take()).toThrow();
  expect(() => b.take()).toThrow();
});
it('logout limpia datos, listeners, HTTP y capturas; una nueva sesión ignora callbacks de la anterior', async () => {
  const { monitor, transport, requests, sessions, session, fleet, alerts } = setup();
  const old = transport.latest;
  old.ready();
  old.frame(change());
  requests[0]!.result.resolve(snapshot());
  await flush();
  const capture = monitor.capture(() => true);
  expect(fleet.total()).toBe(1);
  alerts.selectVehicle('A');
  expect(alerts.vehicleId()).toBe('A');
  sessions.clear();
  TestBed.tick();
  expect(monitor.phase()).toBe('idle');
  expect(monitor.hasBase()).toBe(false);
  expect(capture.active).toBe(false);
  expect(fleet.total()).toBe(0);
  expect(alerts.total()).toBe(0);
  expect(alerts.vehicleId()).toBeNull();
  expect(old.closed).toBe(true);
  expect(transport.resumes.size).toBe(0);
  sessions.accept({ ...session, csrfToken: 'b'.repeat(256) }, sessions.epoch);
  TestBed.tick();
  old.frame(change('obsolete'));
  old.fail();
  expect(fleet.total()).toBe(0);
  expect(monitor.phase()).toBe('loading');
  expect(transport.sources.length).toBe(2);
  expect(transport.resumes.size).toBe(1);
});
it('error SSE conserva la sesión; solo HTTP SESSION_REQUIRED confirmado la retira', async () => {
  const { monitor, transport, sessions, access, clock } = setup();
  access.current.mockRejectedValueOnce(
    new HttpErrorResponse({ status: 403, error: { code: 'SESSION_REQUIRED' } }),
  );
  transport.latest.fail();
  expect(sessions.session()).not.toBeNull();
  clock.advance(2000);
  await flush();
  expect(sessions.session()).toBeNull();
  expect(monitor.phase()).toBe('idle');
  expect(transport.resumes.size).toBe(0);
});
it('una nueva cookie detectada por CSRF cambia de ámbito y descarta la base de la sesión anterior', async () => {
  const { monitor, transport, sessions, session, access, clock, requests, fleet } = setup();
  transport.latest.ready();
  transport.latest.frame(change());
  requests[0]!.result.resolve(snapshot());
  await flush();
  const epoch = sessions.epoch;
  access.current.mockResolvedValueOnce({ ...session, csrfToken: 'b'.repeat(256) });
  transport.latest.fail();
  clock.advance(2000);
  await flush();
  expect(sessions.epoch).toBe(epoch + 1);
  expect(fleet.total()).toBe(0);
  expect(monitor.hasBase()).toBe(false);
  expect(monitor.phase()).toBe('loading');
  expect(transport.sources.filter((s) => !s.closed).length).toBe(1);
});
it('Retry-After limita incluso la acción manual y una fecha inválida no bloquea indefinidamente', async () => {
  const { monitor, transport, requests, clock } = setup();
  transport.latest.ready();
  requests[0]!.result.reject(
    new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '60' }) }),
  );
  await flush();
  monitor.reconnect();
  clock.advance(59999);
  await flush();
  expect(transport.sources.length).toBe(1);
  clock.advance(1);
  await flush();
  expect(transport.sources.length).toBe(2);
  monitor.noteRetryAfter(
    new HttpErrorResponse({ headers: new HttpHeaders({ 'Retry-After': 'Wed, invalid' }) }),
  );
  expect(monitor.retryWait).toBe(0);
});
it('una sesión vencida durante suspensión se limpia antes de abrir otra conexión', () => {
  const { monitor, transport, clock, sessions } = setup();
  clock.wallTime += 3600001;
  transport.resume();
  expect(sessions.session()).toBeNull();
  expect(monitor.phase()).toBe('idle');
  expect(transport.sources.length).toBe(1);
  expect(transport.latest.closed).toBe(true);
});

it('volver de suspensión antes de ready también respeta los diez segundos de plazo', () => {
  const { transport, clock, monitor } = setup();
  clock.wallTime += 11000;
  transport.resume();
  expect(transport.latest.closed).toBe(true);
  expect(monitor.hasBase()).toBe(false);
});

it('un sondeo HTTP de una generación anterior no retira la nueva sesión al fallar tarde', async () => {
  const { transport, clock, monitor, access, sessions, session } = setup();
  const pending = deferred<typeof session>();
  access.current.mockImplementationOnce(() => pending.promise);
  transport.latest.fail();
  clock.advance(2000);
  await flush();
  sessions.clear();
  sessions.accept({ ...session, csrfToken: 'b'.repeat(256) }, sessions.epoch);
  TestBed.tick();
  pending.reject(new HttpErrorResponse({ status: 403, error: { code: 'SESSION_REQUIRED' } }));
  await flush();
  expect(sessions.session()?.csrfToken).toBe('b'.repeat(256));
  expect(monitor.phase()).toBe('loading');
  expect(transport.sources.filter((source) => !source.closed).length).toBe(1);
});

it('una respuesta HTTP de sesión ya vencida impide reabrir el stream', async () => {
  const { transport, clock, monitor, access, sessions, session } = setup();
  access.current.mockResolvedValueOnce({ ...session, expiresAt: new Date(0).toISOString() });
  transport.latest.fail();
  clock.advance(2000);
  await flush();
  expect(sessions.session()).toBeNull();
  expect(monitor.phase()).toBe('idle');
  expect(transport.sources.length).toBe(1);
});
