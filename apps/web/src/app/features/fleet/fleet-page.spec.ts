import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import type { EventView } from '@nexo/contracts';
import { FleetPage } from './fleet-page';
import { FleetFacade } from './fleet-facade';
import { VehicleDetailFacade } from './vehicle-detail-facade';
import type { DetailPhase } from './vehicle-detail-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';

function setup() {
  const selected = signal<string | null>(null),
    phase = signal<DetailPhase>('closed');
  const hasBase = signal(false),
    items = signal<readonly EventView[]>([]);
  const focusedEvent = signal<string | null>(null);
  const detail = {
    selected,
    focusedEvent,
    focusedObservation: computed(() => items().find((item) => item.eventId === focusedEvent())),
    phase,
    hasBase,
    items,
    total: computed(() => items().length),
    select: vi.fn((id: string) => {
      selected.set(id);
      phase.set('loading');
    }),
    close: vi.fn(() => {
      selected.set(null);
      phase.set('closed');
      hasBase.set(false);
    }),
    retry: vi.fn(),
  };
  const monitor = { hasBase: signal(false) };
  TestBed.configureTestingModule({
    imports: [FleetPage],
    providers: [
      { provide: VehicleDetailFacade, useValue: detail },
      { provide: LiveMonitor, useValue: monitor },
    ],
  });
  const fixture = TestBed.createComponent(FleetPage);
  const root: HTMLElement = fixture.nativeElement;
  return { fixture, root, detail, monitor, fleet: TestBed.inject(FleetFacade) };
}
const vehicle = {
  eventId: 'event',
  vehicleId: 'VEH_01',
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph: 0,
  ignitionOn: true,
  status: 'STOPPED' as const,
};

it('distingue primera carga, vacío confirmado y búsqueda sin coincidencias sin borrar la flota', async () => {
  const { fixture, root, monitor, fleet } = setup();
  await fixture.whenStable();
  expect(root.textContent).not.toContain('No hay vehículos registrados.');
  expect(root.querySelector('input')?.disabled).toBe(true);
  monitor.hasBase.set(true);
  await fixture.whenStable();
  expect(root.textContent).toContain('No hay vehículos registrados.');
  fleet.install([vehicle]);
  await fixture.whenStable();
  const input = root.querySelector('input')!;
  input.value = 'missing';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
  expect(root.textContent).toContain('No hay vehículos que coincidan');
  expect(fleet.total()).toBe(1);
  const clear = [...root.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Limpiar'),
  )!;
  clear.click();
  await fixture.whenStable();
  expect(root.querySelectorAll('tbody tr').length).toBe(1);
});

it('error de historial sin base no muestra vacío; datos anteriores se señalan como desactualizados', async () => {
  const { fixture, root, detail, monitor, fleet } = setup();
  monitor.hasBase.set(true);
  fleet.install([vehicle]);
  detail.selected.set(vehicle.vehicleId);
  detail.phase.set('error');
  await fixture.whenStable();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('No fue posible cargar');
  expect(root.textContent).not.toContain('No hay observaciones');
  const retry = [...root.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Reintentar'),
  )!;
  retry.click();
  expect(detail.retry).toHaveBeenCalledTimes(1);
  detail.hasBase.set(true);
  detail.items.set([vehicle]);
  detail.phase.set('waiting');
  await fixture.whenStable();
  expect(root.textContent).toContain('pueden estar desactualizados');
  expect(root.querySelectorAll('nexo-vehicle-history tbody tr').length).toBe(1);
  fleet.install([]);
  detail.items.set([]);
  detail.phase.set('ready');
  await fixture.whenStable();
  expect(root.textContent).toContain('Este vehículo no aparece en la flota actual.');
});

it('abrir enfoca el panel y cerrar devuelve foco a su fila o a búsqueda si ya no está visible', async () => {
  const { fixture, root, monitor, fleet } = setup();
  monitor.hasBase.set(true);
  fleet.install([vehicle]);
  await fixture.whenStable();
  const button = root.querySelector('nexo-fleet-table button')! as HTMLButtonElement;
  button.click();
  await fixture.whenStable();
  expect(document.activeElement).toBe(root.querySelector('#vehicle-history'));
  fleet.setSearch('missing');
  await fixture.whenStable();
  fixture.componentInstance.close();
  await fixture.whenStable();
  expect(document.activeElement).toBe(root.querySelector('input'));
});
