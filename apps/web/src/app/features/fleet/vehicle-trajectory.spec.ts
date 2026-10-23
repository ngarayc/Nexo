import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import type { EventView } from '@nexo/contracts';
import { MapProviderStore } from '../../platform/maps/map-provider-store';
import { VehicleTrajectory } from './vehicle-trajectory';
import { TRAJECTORY_FACTORY } from './adapters/trajectory-factory';
import type { TrajectoryFactory } from './adapters/trajectory-renderer';

const event: EventView = {
  eventId: 'E<safe>',
  vehicleId: 'A',
  observedAt: '2026-01-01T05:00:00Z',
  latitude: 14.6,
  longitude: -90.5,
  speedKph: 81,
  ignitionOn: true,
};
function setup(items: readonly EventView[] = [event]) {
  const provider = {
    provider: signal({
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      allowedOrigin: 'https://tile.openstreetmap.org',
      attribution: '© OpenStreetMap contributors',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
      maxZoom: 18,
    }),
    phase: signal<'ready' | 'error'>('ready'),
    load: vi.fn(),
  };
  const renderer = {
    sync: vi.fn(),
    fit: vi.fn(),
    fitGeofence: vi.fn(),
    focusEvent: vi.fn(),
    retryTiles: vi.fn(),
    destroy: vi.fn(),
  };
  const create: TrajectoryFactory = () => renderer;
  const factory = vi.fn(create);
  TestBed.configureTestingModule({
    imports: [VehicleTrajectory],
    providers: [
      { provide: MapProviderStore, useValue: provider },
      { provide: TRAJECTORY_FACTORY, useValue: factory },
    ],
  });
  const fixture = TestBed.createComponent(VehicleTrajectory);
  fixture.componentRef.setInput('vehicleId', 'A');
  fixture.componentRef.setInput('items', items);
  return { fixture, root: fixture.nativeElement as HTMLElement, provider, renderer, factory };
}
it('vacío no inventa punto, segmento o centro y conserva explicación accesible', async () => {
  const { fixture, root, factory } = setup([]);
  await fixture.whenStable();
  expect(factory).not.toHaveBeenCalled();
  expect(root.textContent).toContain('No hay observaciones disponibles');
  expect(root.textContent).toContain('No representan una ruta calculada');
  expect(root.querySelector('button')?.disabled).toBe(true);
});
it('conserva muestras coincidentes y transmite selección por identidad sin reordenar o consultar', async () => {
  const coincident = { ...event, eventId: 'E2', observedAt: '2026-01-01T05:00:00.000000000001Z' };
  const { fixture, factory, renderer } = setup([event, coincident]);
  const selection = vi.fn();
  fixture.componentInstance.selectEvent.subscribe(selection);
  await fixture.whenStable();
  expect(renderer.sync).toHaveBeenLastCalledWith('A', [event, coincident], null);
  factory.mock.calls[0]![2](coincident.eventId);
  expect(selection).toHaveBeenCalledWith(coincident.eventId);
  fixture.componentRef.setInput('selected', coincident.eventId);
  await fixture.whenStable();
  expect(renderer.sync).toHaveBeenLastCalledWith('A', [event, coincident], coincident.eventId);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(renderer.fit).not.toHaveBeenCalled();
});
it('muestra valores originales y hora24h; selección ausente se informa sin inventar datos', async () => {
  const { fixture, root } = setup([{ ...event, latitude: 90 }]);
  fixture.componentRef.setInput('selected', event.eventId);
  await fixture.whenStable();
  expect(root.textContent).toContain('E<safe>');
  expect(root.textContent).toContain('01/01/2026 00:00:00 (Bogotá)');
  expect(root.textContent).toContain('81 km/h');
  expect(root.textContent).toContain('Algunas latitudes superan');
  expect(fixture.componentInstance.observation()?.latitude).toBe(90);
  fixture.componentRef.setInput('items', []);
  await fixture.whenStable();
  expect(root.textContent).toContain('no aparece en el historial disponible');
  expect(root.querySelector('dl')).toBeNull();
});
it('fallo y reintento de tiles no borran muestras; acciones y destrucción usan un solo adaptador', async () => {
  const { fixture, root, factory, renderer } = setup();
  await fixture.whenStable();
  factory.mock.calls[0]![3]('error');
  await fixture.whenStable();
  expect(root.textContent).toContain('El historial sigue disponible');
  [...root.querySelectorAll('button')]
    .find((button) => button.textContent?.includes('Reintentar'))!
    .click();
  expect(renderer.retryTiles).toHaveBeenCalledTimes(1);
  root.querySelector('button')!.click();
  expect(renderer.fit).toHaveBeenCalledTimes(1);
  fixture.componentInstance.focusEvent(event.eventId);
  expect(renderer.focusEvent).toHaveBeenCalledWith(event.eventId);
  fixture.componentRef.setInput('vehicleId', 'B');
  fixture.componentRef.setInput('items', []);
  await fixture.whenStable();
  expect(renderer.sync).toHaveBeenLastCalledWith('B', [], null);
  fixture.destroy();
  expect(renderer.destroy).toHaveBeenCalledTimes(1);
});
it('un cambio observado selecciona su muestra original y no inventa la hora de cruce', async () => {
  const after = {
    ...event,
    eventId: 'E2',
    latitude: 14.612,
    longitude: -90.538,
    observedAt: '2026-01-01T05:01:00Z',
  };
  const { fixture, root, renderer } = setup([after, event]);
  const selection = vi.fn();
  fixture.componentInstance.selectEvent.subscribe(selection);
  await fixture.whenStable();
  expect(root.textContent).toContain('Entrada observada');
  expect(root.textContent).toContain('no determina el punto ni la hora exacta');
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent?.includes('Ver observación E2'))!
    .click();
  expect(selection).toHaveBeenCalledWith('E2');
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent?.includes('Ver geocerca en trayectoria'))!
    .click();
  expect(renderer.fitGeofence).toHaveBeenCalledTimes(1);
});
