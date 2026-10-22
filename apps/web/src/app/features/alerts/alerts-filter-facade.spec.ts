import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import type { AlertView, DomainChange, EventView, VehicleView } from '@nexo/contracts';
import { FleetFacade } from '../fleet/fleet-facade';
import { AlertsFacade } from './alerts-facade';
import { AlertsFilterFacade } from './alerts-filter-facade';

function event(
  vehicleId: string,
  eventId = vehicleId,
  observedAt = '2026-01-01T18:00:00Z',
): EventView {
  return {
    eventId,
    vehicleId,
    observedAt,
    latitude: 4,
    longitude: -74,
    speedKph: 81,
    ignitionOn: true,
  };
}
function alert(vehicleId: string, eventId = vehicleId, observedAt?: string): AlertView {
  const source = event(vehicleId, eventId, observedAt);
  return {
    type: 'OVERSPEED',
    eventId,
    vehicleId,
    observedAt: source.observedAt,
    latitude: source.latitude,
    longitude: source.longitude,
    speedKph: source.speedKph,
  };
}
function vehicle(id: string): VehicleView {
  return { ...event(id), status: 'MOVING' };
}
function created(vehicleId: string, eventId: string, observedAt: string): DomainChange {
  const data = event(vehicleId, eventId, observedAt);
  return {
    type: 'alert.created',
    messageId: 'message-' + eventId,
    schemaVersion: 1,
    vehicleId,
    eventId,
    observedAt,
    data: { ...data, type: 'OVERSPEED' },
  };
}
function setup() {
  TestBed.configureTestingModule({});
  return {
    model: TestBed.inject(AlertsFilterFacade),
    fleet: TestBed.inject(FleetFacade),
    alerts: TestBed.inject(AlertsFacade),
  };
}

it('ofrece toda la flota, incluidos vehículos sin alertas, y separa visible del total global', () => {
  const { model, fleet, alerts } = setup();
  fleet.install(['A', 'B', 'C'].map(vehicle));
  alerts.install([
    alert('A', 'a', '2026-01-01T18:00:00Z'),
    alert('B', 'b', '2026-01-01T19:00:00Z'),
    alert('A', 'c', '2026-01-01T20:00:00Z'),
  ]);
  fleet.setSearch('B');
  expect(fleet.visibleItems()).toHaveLength(1);
  expect(model.options().map((option) => option.vehicleId)).toEqual(['A', 'B', 'C']);
  model.selectKey(JSON.stringify('A'));
  expect(model.items().map((item) => item.eventId)).toEqual(['c', 'a']);
  expect([model.total(), model.overallTotal(), alerts.total()]).toEqual([2, 3, 3]);
  model.selectKey(JSON.stringify('C'));
  expect([model.total(), model.overallTotal()]).toEqual([0, 3]);
  model.selectKey('unknown-dom-value');
  expect(model.vehicleId()).toBe('C');
  model.showAll();
  expect(model.vehicleId()).toBeNull();
  expect(model.total()).toBe(3);
});

it('la opción global no colisiona con ningún ID y las claves conservan unidades y selección al reordenar', () => {
  const { model, fleet, alerts } = setup();
  const ids = ['all', 'Todos los vehículos', 'A', 'A ', 'a', '\u0000\ud800', 'x'.repeat(70000)];
  fleet.install(ids.map(vehicle));
  alerts.install(ids.map((id, n) => alert(id, 'literal-' + n)));
  const keys = model.options().map((option) => option.key);
  expect(new Set(keys).size).toBe(ids.length);
  expect(keys).not.toContain(model.allKey);
  for (const [n, id] of ids.entries()) {
    model.selectKey(JSON.stringify(id));
    expect(model.vehicleId()).toBe(id);
    expect(model.items().map((item) => item.eventId)).toEqual(['literal-' + n]);
  }
  const previous = model.selectionKey();
  fleet.install([vehicle('!'), ...ids.map(vehicle)]);
  expect(model.selectionKey()).toBe(previous);
  expect(model.items()).toHaveLength(1);
  model.selectKey(model.allKey);
  expect(model.vehicleId()).toBeNull();
  expect(model.total()).toBe(ids.length);
});

it('SSE coincidente, no coincidente y repetido conserva el filtro; recuperación retiene ausente y logout lo limpia', () => {
  const { model, fleet, alerts } = setup();
  fleet.install(['A', 'B'].map(vehicle));
  alerts.install([alert('A', 'first')]);
  model.selectKey(JSON.stringify('A'));
  const other = created('B', 'other', '2026-01-01T19:00:00Z');
  alerts.apply(other);
  expect([model.total(), model.overallTotal()]).toEqual([1, 2]);
  const same = created('A', 'same', '2026-01-01T20:00:00Z');
  alerts.apply(same);
  alerts.apply({ ...same, messageId: 'repeated-with-another-transport-id' });
  expect([model.total(), model.overallTotal()]).toEqual([2, 3]);
  expect(model.items().map((item) => item.eventId)).toEqual(['same', 'first']);
  // Una nueva base coherente ya no contiene A; conservar la intención del cliente.
  fleet.install([vehicle('B')]);
  alerts.install([alert('B', 'other')]);
  expect(model.vehicleId()).toBe('A');
  expect(model.missing()).toBe(true);
  expect(model.options().find((option) => option.vehicleId === 'A')?.label).toContain('ausente');
  expect([model.total(), model.overallTotal()]).toEqual([0, 1]);
  model.showAll();
  expect(model.missing()).toBe(false);
  expect(model.options().map((option) => option.vehicleId)).toEqual(['B']);
  model.selectKey(JSON.stringify('B'));
  alerts.clear();
  fleet.clear();
  expect(model.vehicleId()).toBeNull();
  expect(model.options()).toEqual([]);
  expect(model.total()).toBe(0);
});
