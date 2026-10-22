import { expect, it } from 'vitest';
import { vehicleState } from '@nexo/contracts';
import type { DomainChange, EventView, VehicleView } from '@nexo/contracts';
import { FleetFacade } from './fleet-facade';
import { AlertsFacade } from '../alerts/alerts-facade';

const event = (values: Partial<EventView> = {}): EventView => ({
  eventId: 'E-1',
  vehicleId: 'V-1',
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph: 81,
  ignitionOn: true,
  ...values,
});
const vehicle = (source: EventView): VehicleView => ({ ...source, status: vehicleState(source) });
function update(source: EventView): DomainChange {
  return {
    messageId: 'update-' + source.eventId,
    schemaVersion: 1,
    type: 'vehicle.updated',
    eventId: source.eventId,
    vehicleId: source.vehicleId,
    observedAt: source.observedAt,
    data: { ...source, state: vehicleState(source) },
  };
}
function alert(source: EventView): DomainChange {
  return {
    messageId: 'alert-' + source.eventId,
    schemaVersion: 1,
    type: 'alert.created',
    eventId: source.eventId,
    vehicleId: source.vehicleId,
    observedAt: source.observedAt,
    data: { ...source, type: 'OVERSPEED' },
  };
}
it('el último estado no retrocede aunque las fechas difieran solo después del nanosegundo', () => {
  const fleet = new FleetFacade();
  fleet.install([
    vehicle(event({ eventId: 'middle', observedAt: '2026-01-01T00:00:00.000000000002Z' })),
  ]);
  fleet.apply(update(event({ eventId: 'z-old', observedAt: '2026-01-01T00:00:00.000000000001Z' })));
  expect(fleet.get('V-1')?.eventId).toBe('middle');
  const newer = update(
    event({ eventId: 'a-new', observedAt: '2026-01-01T00:00:00.000000000003Z' }),
  );
  fleet.apply(newer);
  fleet.apply(newer);
  expect(fleet.get('V-1')?.eventId).toBe('a-new');
  expect(fleet.total()).toBe(1);
});
it('el desempate y orden de vehículos usan puntos de código completos, también para astrales', () => {
  const fleet = new FleetFacade();
  fleet.install([vehicle(event({ eventId: '\ue000' }))]);
  fleet.apply(update(event({ eventId: '\u{10000}' })));
  expect(fleet.get('V-1')?.eventId).toBe('\u{10000}');
  fleet.install([
    vehicle(event({ vehicleId: '\u{10000}' })),
    vehicle(event({ vehicleId: '\ue000' })),
  ]);
  expect(fleet.items().map((view) => view.vehicleId)).toEqual(['\ue000', '\u{10000}']);
});
it('un tardío puede añadir alerta sin reemplazar latest; duplicar transporte no incrementa el total', () => {
  const fleet = new FleetFacade(),
    alerts = new AlertsFacade();
  fleet.install([
    vehicle(event({ eventId: 'latest', observedAt: '2026-01-01T00:00:02Z', speedKph: 0 })),
  ]);
  const late = event({ eventId: 'late', speedKph: 95 });
  const accepted: DomainChange = {
    messageId: 'accepted',
    schemaVersion: 1,
    type: 'telemetry.accepted',
    eventId: late.eventId,
    vehicleId: late.vehicleId,
    observedAt: late.observedAt,
    data: late,
  };
  fleet.apply(accepted);
  alerts.apply(update(late));
  expect(alerts.total()).toBe(0);
  const received = alert(late);
  alerts.apply(received);
  alerts.apply({ ...received, messageId: 'transport-repeat' });
  expect(fleet.get('V-1')?.eventId).toBe('latest');
  expect(fleet.get('V-1')?.status).toBe('STOPPED');
  expect(alerts.total()).toBe(1);
  expect(alerts.items()[0]?.eventId).toBe('late');
  expect(alerts.items()[0]?.speedKph).toBe(95);
});
it('búsqueda literal sin distinguir mayúsculas conserva la base completa y el contador de alertas', () => {
  const fleet = new FleetFacade(),
    other = new FleetFacade(),
    alerts = new AlertsFacade();
  const base = ['VEH_01', 'VEH%02', 'veh303'].map((vehicleId) => vehicle(event({ vehicleId })));
  fleet.install(base);
  other.install(base);
  alerts.apply(alert(event({ vehicleId: 'VEH_01' })));
  fleet.setSearch('%');
  expect(fleet.visibleItems().map((view) => view.vehicleId)).toEqual(['VEH%02']);
  expect(fleet.total()).toBe(3);
  expect(alerts.total()).toBe(1);
  expect(other.visibleItems().length).toBe(3);
  fleet.setSearch('_');
  expect(fleet.visibleItems().map((view) => view.vehicleId)).toEqual(['VEH_01']);
  fleet.setSearch('VeH');
  expect(fleet.visibleItems().length).toBe(3);
  fleet.setSearch(' %');
  expect(fleet.visibleItems().length).toBe(0);
  fleet.setSearch('');
  expect(fleet.visibleItems().length).toBe(3);
});
it('resumen y totales se derivan del modelo completo aun cuando la búsqueda no tenga coincidencias', () => {
  const fleet = new FleetFacade();
  fleet.install([
    vehicle(event({ vehicleId: 'off', ignitionOn: false })),
    vehicle(event({ vehicleId: 'stopped', speedKph: 0 })),
    vehicle(event({ vehicleId: 'moving' })),
  ]);
  fleet.setSearch('missing');
  expect(fleet.visibleItems().length).toBe(0);
  expect(fleet.total()).toBe(3);
  expect(fleet.summary()).toEqual({ OFF: 1, MOVING: 1, STOPPED: 1 });
  expect(Object.isFrozen(fleet.visibleItems())).toBe(true);
});
it('alertas mantienen identidad única y orden descendente con precisión exacta', () => {
  const alerts = new AlertsFacade();
  alerts.apply(alert(event({ eventId: 'newer', observedAt: '2026-01-01T00:00:00.000000000002Z' })));
  alerts.apply(alert(event({ eventId: 'older', observedAt: '2026-01-01T00:00:00.000000000001Z' })));
  alerts.apply(alert(event({ eventId: 'newer', observedAt: '2026-01-01T00:00:00.000000000002Z' })));
  expect(alerts.items().map((view) => view.eventId)).toEqual(['newer', 'older']);
  expect(alerts.total()).toBe(2);
});
it('instalar una nueva base reemplaza entidades antiguas y clear elimina datos y búsqueda de la sesión', () => {
  const fleet = new FleetFacade(),
    alerts = new AlertsFacade();
  fleet.install([vehicle(event())]);
  alerts.apply(alert(event()));
  fleet.setSearch('V-1');
  fleet.install([vehicle(event({ vehicleId: 'V-2' }))]);
  alerts.install([]);
  expect(fleet.get('V-1')).toBeUndefined();
  expect(fleet.get('V-2')?.vehicleId).toBe('V-2');
  expect(alerts.total()).toBe(0);
  fleet.clear();
  alerts.clear();
  expect(fleet.items()).toEqual([]);
  expect(fleet.search()).toBe('');
  expect(alerts.items()).toEqual([]);
});
