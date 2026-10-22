import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import type { DomainChange, EventView, VehicleHistory } from '@nexo/contracts';
import { VehicleDetailFacade } from './vehicle-detail-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { TelemetryApi } from '../../platform/telemetry/telemetry-api';
import { CaptureBudget } from '../../platform/telemetry/capture-budget';

const observation = (
  eventId: string,
  vehicleId = 'A',
  observedAt = '2026-01-01T00:00:00Z',
): EventView => ({
  eventId,
  vehicleId,
  observedAt,
  latitude: 4,
  longitude: -74,
  speedKph: 0,
  ignitionOn: true,
});
class Monitor {
  currentGeneration: number | undefined = 1;
  retryWait = 0;
  budget = new CaptureBudget();
  ready = new Set<() => void>();
  invalidated = new Set<(clear: boolean) => void>();
  frames = new Set<(change: DomainChange) => void>();
  capture = (predicate: (change: DomainChange) => boolean) => this.budget.begin(predicate);
  noteRetryAfter = vi.fn();
  onReady(listener: () => void) {
    this.ready.add(listener);
    return () => {
      this.ready.delete(listener);
    };
  }
  onInvalidated(listener: (clear: boolean) => void) {
    this.invalidated.add(listener);
    return () => {
      this.invalidated.delete(listener);
    };
  }
  onFrame(listener: (change: DomainChange) => void) {
    this.frames.add(listener);
    return () => {
      this.frames.delete(listener);
    };
  }
  emit(data: EventView) {
    const change: DomainChange = {
      messageId: 'accepted-' + data.eventId,
      type: 'telemetry.accepted',
      schemaVersion: 1,
      eventId: data.eventId,
      vehicleId: data.vehicleId,
      observedAt: data.observedAt,
      data,
    };
    this.budget.push({ change, bytes: 100 });
    for (const listener of this.frames) listener(change);
  }
  invalidate(clear = false) {
    this.currentGeneration = undefined;
    this.budget.clear();
    for (const listener of this.invalidated) listener(clear);
  }
  recover() {
    this.currentGeneration = 2;
    for (const listener of this.ready) listener();
  }
}
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function setup() {
  const monitor = new Monitor();
  const requests: {
    id: string;
    signal: AbortSignal;
    resolve: (history: VehicleHistory) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  const api = {
    history: vi.fn(
      (id: string, signal: AbortSignal) =>
        new Promise<VehicleHistory>((resolve, reject) => {
          requests.push({ id, signal, resolve, reject });
        }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: LiveMonitor, useValue: monitor },
      { provide: TelemetryApi, useValue: api },
    ],
  });
  return { monitor, api, requests, detail: TestBed.inject(VehicleDetailFacade) };
}
it('captura antes de HTTP y combina base y tardíos por identidad y orden exacto', async () => {
  const { detail, requests, monitor, api } = setup();
  api.history.mockImplementationOnce((id, signal) => {
    monitor.emit(observation('during'));
    return new Promise<VehicleHistory>((resolve, reject) => {
      requests.push({ id, signal, resolve, reject });
    });
  });
  detail.select('A');
  const base = observation('base', 'A', '2026-01-01T00:00:00.000000000001Z');
  requests[0]!.resolve({ vehicleId: 'A', items: [base], total: 1 });
  await flush();
  expect(detail.items().map((item) => item.eventId)).toEqual(['during', 'base']);
  monitor.emit(observation('during'));
  monitor.emit(observation('late', 'A', '2025-01-01T00:00:00Z'));
  monitor.emit(observation('unrelated', 'B'));
  expect(detail.items().map((item) => item.eventId)).toEqual(['late', 'during', 'base']);
  expect(detail.phase()).toBe('ready');
  expect(detail.hasBase()).toBe(true);
  expect(monitor.budget.retainedMessages).toBe(0);
});
it('selección A → B cancela A y una respuesta tardía de A no reemplaza B', async () => {
  const { detail, requests } = setup();
  detail.select('A');
  detail.select('B');
  expect(requests[0]!.signal.aborted).toBe(true);
  requests[1]!.resolve({ vehicleId: 'B', items: [observation('b', 'B')], total: 1 });
  await flush();
  requests[0]!.resolve({ vehicleId: 'A', items: [observation('a')], total: 1 });
  await flush();
  expect(detail.selected()).toBe('B');
  expect(detail.items().map((item) => item.eventId)).toEqual(['b']);
  detail.close();
  expect(detail.items()).toEqual([]);
  expect(detail.phase()).toBe('closed');
});
it('recuperar conexión reemplaza historial; revocar sesión cierra y descarta selección', async () => {
  const { detail, requests, monitor } = setup();
  detail.select('A');
  requests[0]!.resolve({ vehicleId: 'A', items: [observation('old')], total: 1 });
  await flush();
  monitor.invalidate();
  expect(detail.phase()).toBe('waiting');
  expect(detail.total()).toBe(1);
  monitor.recover();
  expect(detail.phase()).toBe('loading');
  requests[1]!.resolve({ vehicleId: 'A', items: [], total: 0 });
  await flush();
  expect(detail.items()).toEqual([]);
  monitor.invalidate(true);
  expect(detail.selected()).toBeNull();
  expect(detail.hasBase()).toBe(false);
});
it('fallo de detalle no se convierte en vacío confirmado y permite reintentar sin abrir SSE', async () => {
  const { detail, requests, monitor } = setup();
  detail.select('A');
  monitor.emit(observation('buffered'));
  requests[0]!.reject(new Error('Unavailable'));
  await flush();
  expect(detail.phase()).toBe('error');
  expect(detail.hasBase()).toBe(false);
  expect(monitor.budget.retainedMessages).toBe(0);
  detail.retry();
  requests[1]!.resolve({ vehicleId: 'A', items: [observation('persisted')], total: 1 });
  await flush();
  expect(detail.total()).toBe(1);
  expect(detail.phase()).toBe('ready');
});
it('espera la base global y cerrar libera captura, petición y suscripciones al destruir', () => {
  const { detail, monitor, requests } = setup();
  monitor.invalidate();
  detail.select('A');
  expect(detail.phase()).toBe('waiting');
  expect(requests.length).toBe(0);
  monitor.recover();
  monitor.emit(observation('buffered'));
  expect(monitor.budget.retainedMessages).toBe(1);
  detail.ngOnDestroy();
  expect(requests[0]!.signal.aborted).toBe(true);
  expect(monitor.budget.retainedMessages).toBe(0);
  expect(monitor.frames.size).toBe(0);
  expect(monitor.ready.size).toBe(0);
});

it('enlazar una alerta conserva su evento y seleccionarlo en el mismo vehículo no repite HTTP', async () => {
  const { detail, requests, monitor } = setup();
  detail.select('A', 'late');
  requests[0]!.resolve({
    vehicleId: 'A',
    items: [observation('late'), observation('new')],
    total: 2,
  });
  await flush();
  expect(detail.focusedEvent()).toBe('late');
  expect(detail.focusedObservation()?.eventId).toBe('late');
  detail.select('A', 'new');
  expect(requests.length).toBe(1);
  expect(detail.focusedObservation()?.eventId).toBe('new');
  monitor.invalidate();
  expect(detail.focusedEvent()).toBe('new');
  monitor.invalidate(true);
  expect(detail.focusedEvent()).toBeNull();
  expect(detail.focusedObservation()).toBeUndefined();
});
