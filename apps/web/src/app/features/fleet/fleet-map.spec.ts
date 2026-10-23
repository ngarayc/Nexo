import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import type { VehicleView } from '@nexo/contracts';
import { MapProviderStore } from '../../platform/maps/map-provider-store';
import { FleetMap } from './fleet-map';
import { FLEET_MAP_FACTORY } from './adapters/fleet-map-factory';
import type { FleetMapFactory } from './adapters/fleet-map-renderer';

const provider = {
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  allowedOrigin: 'https://tile.openstreetmap.org',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  maxZoom: 18,
};
const vehicle: VehicleView = {
  vehicleId: 'V\u0000\ud800',
  eventId: 'E1',
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 14.6,
  longitude: -90.5,
  speedKph: 81,
  ignitionOn: true,
  status: 'MOVING',
};

function setup(items: readonly VehicleView[] = [vehicle]) {
  const store = {
    provider: signal(provider),
    phase: signal<'ready' | 'error'>('ready'),
    load: vi.fn(),
  };
  const renderer = {
    sync: vi.fn(),
    fit: vi.fn(),
    focusVehicle: vi.fn(),
    retryTiles: vi.fn(),
    destroy: vi.fn(),
  };
  const create: FleetMapFactory = () => renderer;
  const factory = vi.fn(create);
  TestBed.configureTestingModule({
    imports: [FleetMap],
    providers: [
      { provide: MapProviderStore, useValue: store },
      { provide: FLEET_MAP_FACTORY, useValue: factory },
    ],
  });
  const fixture = TestBed.createComponent(FleetMap);
  fixture.componentRef.setInput('items', items);
  return { fixture, root: fixture.nativeElement as HTMLElement, store, renderer, factory };
}

it('sin posiciones muestra vacío y no crea mapa o centro ficticio', async () => {
  const { fixture, root, factory } = setup([]);
  await fixture.whenStable();
  expect(root.textContent).toContain('No hay posiciones de vehículos visibles');
  expect(factory).not.toHaveBeenCalled();
  expect(root.querySelector('button')?.disabled).toBe(true);
});
it('un solo renderer recibe la colección, conserva IDs y propaga selección sin recapturar datos', async () => {
  const { fixture, factory, renderer } = setup();
  const selected = vi.fn();
  fixture.componentInstance.selectVehicle.subscribe(selected);
  await fixture.whenStable();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(renderer.sync).toHaveBeenLastCalledWith([vehicle], null);
  factory.mock.calls[0]![2](vehicle.vehicleId);
  expect(selected).toHaveBeenCalledWith(vehicle.vehicleId);
  fixture.componentRef.setInput('selected', vehicle.vehicleId);
  fixture.componentRef.setInput('items', [{ ...vehicle, eventId: 'E2', latitude: 14.7 }]);
  await fixture.whenStable();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(renderer.fit).not.toHaveBeenCalled();
  fixture.componentInstance.focusVehicle(vehicle.vehicleId);
  expect(renderer.focusVehicle).toHaveBeenCalledWith(vehicle.vehicleId);
  fixture.componentRef.setInput('items', []);
  await fixture.whenStable();
  expect(renderer.sync).toHaveBeenLastCalledWith([], vehicle.vehicleId);
  fixture.destroy();
  expect(renderer.destroy).toHaveBeenCalledTimes(1);
});
it('error de tiles ofrece reintento local sin borrar posiciones', async () => {
  const { fixture, root, factory, renderer } = setup();
  await fixture.whenStable();
  factory.mock.calls[0]![3]('error');
  await fixture.whenStable();
  expect(root.textContent).toContain('La tabla y el historial siguen disponibles.');
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent?.includes('Reintentar mapa'))!
    .click();
  expect(renderer.retryTiles).toHaveBeenCalledTimes(1);
  expect(fixture.componentInstance.items()).toEqual([vehicle]);
  root.querySelector('button')!.click();
  expect(renderer.fit).toHaveBeenCalledTimes(1);
});
it('latitud polar mantiene dato original y comunica el límite visual de la proyección', async () => {
  const { fixture, root, renderer } = setup([{ ...vehicle, latitude: 90 }]);
  await fixture.whenStable();
  expect(root.textContent).toContain('superan el alcance visual');
  expect(renderer.sync.mock.calls[0]![0][0].latitude).toBe(90);
});
