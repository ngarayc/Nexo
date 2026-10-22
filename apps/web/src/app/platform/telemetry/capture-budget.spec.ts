import { expect, it } from 'vitest';
import { CaptureBudget, ObsoleteCapture } from './capture-budget';
import { CaptureCapacityError, captureLimits } from './telemetry-contract';
import type { DomainFrame } from './telemetry-contract';

function frame(id: number, bytes = 100, vehicleId = 'A'): DomainFrame {
  const data = {
    eventId: String(id),
    vehicleId,
    observedAt: '2026-01-01T00:00:00Z',
    latitude: 4,
    longitude: -74,
    speedKph: 0,
    ignitionOn: true,
  };
  return {
    bytes,
    change: {
      messageId: String(id),
      schemaVersion: 1,
      type: 'telemetry.accepted',
      eventId: data.eventId,
      vehicleId,
      observedAt: data.observedAt,
      data,
    },
  };
}
it('snapshot e historial comparten una trama y repetir UUID no multiplica cantidad o bytes', () => {
  const budget = new CaptureBudget(),
    snapshot = budget.begin(),
    history = budget.begin((change) => change.vehicleId === 'A');
  budget.push(frame(1));
  budget.push(frame(1));
  expect([budget.retainedMessages, budget.retainedBytes]).toEqual([1, 100]);
  expect(snapshot.take().map((change) => change.eventId)).toEqual(['1']);
  expect([budget.retainedMessages, budget.retainedBytes]).toEqual([1, 100]);
  history.cancel();
  history.cancel();
  expect([budget.retainedMessages, budget.retainedBytes]).toEqual([0, 0]);
  expect(() => history.take()).toThrow(ObsoleteCapture);
});
it('el mensaje1001 invalida todas las capturas y no deja un prefijo aplicable', () => {
  const budget = new CaptureBudget(),
    a = budget.begin(),
    b = budget.begin();
  for (let i = 0; i < 1000; i++) budget.push(frame(i, 1));
  expect(budget.retainedMessages).toBe(1000);
  expect(() => budget.push(frame(1000, 1))).toThrow(CaptureCapacityError);
  expect([budget.retainedMessages, budget.retainedBytes]).toEqual([0, 0]);
  expect(a.active || b.active).toBe(false);
  expect(() => a.take()).toThrow(ObsoleteCapture);
  expect(() => b.take()).toThrow(ObsoleteCapture);
});
it('el límite exacto2MiB cabe; otro byte no obtiene un presupuesto por cada captura', () => {
  const budget = new CaptureBudget(),
    a = budget.begin(),
    b = budget.begin();
  budget.push(frame(1, captureLimits.bytes));
  expect(budget.retainedBytes).toBe(captureLimits.bytes);
  expect(() => budget.push(frame(2, 1))).toThrow(CaptureCapacityError);
  expect(a.active || b.active).toBe(false);
  expect(budget.retainedBytes).toBe(0);
});
it('cada selección conserva solo su vehículo y take respeta orden de recepción sin duplicar referencias', () => {
  const budget = new CaptureBudget(),
    all = budget.begin(),
    b = budget.begin((change) => change.vehicleId === 'B');
  budget.push(frame(1, 100, 'A'));
  budget.push(frame(2, 100, 'B'));
  expect(b.take().map((change) => change.eventId)).toEqual(['2']);
  expect(budget.retainedMessages).toBe(2);
  expect(all.take().map((change) => change.eventId)).toEqual(['1', '2']);
  expect(budget.retainedMessages).toBe(0);
});
it('clear invalida el dueño viejo y cancelarlo después no retira datos de una generación nueva', () => {
  const budget = new CaptureBudget(),
    old = budget.begin();
  budget.push(frame(1));
  budget.clear();
  const current = budget.begin();
  budget.push(frame(2));
  old.cancel();
  expect(() => old.take()).toThrow(ObsoleteCapture);
  expect(current.take().map((change) => change.eventId)).toEqual(['2']);
  expect(budget.retainedBytes).toBe(0);
  budget.push(frame(3));
  expect(budget.retainedMessages).toBe(0);
});
