import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, it, vi } from 'vitest';
import { AlertsPage } from './alerts-page';
import { AlertsFacade } from './alerts-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import type { LivePhase } from '../live-monitoring/live-monitor';
import { VehicleDetailFacade } from '../fleet/vehicle-detail-facade';
import { FleetFacade } from '../fleet/fleet-facade';
import { formatIdentity } from '../../platform/presentation/identity-text';

function setup() {
  const monitor = { hasBase: signal(false), phase: signal<LivePhase>('loading') };
  const detail = { select: vi.fn() },
    router = { navigateByUrl: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    imports: [AlertsPage],
    providers: [
      { provide: LiveMonitor, useValue: monitor },
      { provide: VehicleDetailFacade, useValue: detail },
      { provide: Router, useValue: router },
    ],
  });
  const fixture = TestBed.createComponent(AlertsPage);
  const root: HTMLElement = fixture.nativeElement;
  return {
    fixture,
    root,
    monitor,
    detail,
    router,
    alerts: TestBed.inject(AlertsFacade),
    fleet: TestBed.inject(FleetFacade),
  };
}
it('carga/error no afirman ausencia; vacío y datos desactualizados conservan sus estados', async () => {
  const { fixture, root, monitor } = setup();
  await fixture.whenStable();
  expect(root.textContent).not.toContain('No hay alertas');
  expect(root.querySelector('[data-testid="alerts-view-total"]')).toBeNull();
  monitor.phase.set('error');
  await fixture.whenStable();
  expect(root.textContent).toContain('no están disponibles');
  monitor.hasBase.set(true);
  monitor.phase.set('live');
  await fixture.whenStable();
  expect(root.textContent).toContain('No hay alertas de exceso');
  expect(root.querySelector('[data-testid="alerts-view-total"]')?.textContent).toBe('0');
  monitor.phase.set('reconnecting');
  await fixture.whenStable();
  expect(root.textContent).toContain('pueden estar desactualizadas');
});

it('selector completo y contador visible/global conservan foco al actualizar; limpiar vuelve al selector', async () => {
  const { fixture, root, monitor, fleet, alerts } = setup();
  const base = { observedAt: '2026-01-01T18:00:00Z', latitude: 4, longitude: -74, speedKph: 81 };
  const vehicles = ['A', 'B', 'C'].map((vehicleId) => ({
    ...base,
    eventId: vehicleId,
    vehicleId,
    ignitionOn: true,
    status: 'MOVING' as const,
  }));
  fleet.install(vehicles);
  alerts.install([
    { ...base, eventId: 'one', vehicleId: 'A', type: 'OVERSPEED' },
    { ...base, eventId: 'two', vehicleId: 'B', type: 'OVERSPEED' },
  ]);
  monitor.hasBase.set(true);
  monitor.phase.set('live');
  fleet.setSearch('B');
  await fixture.whenStable();
  const select = root.querySelector('select')!;
  expect(select.options).toHaveLength(4);
  expect(select.value).toBe('all');
  select.focus();
  select.value = JSON.stringify('A');
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  expect(root.querySelector('[data-testid="alerts-view-total"]')?.textContent).toBe('1');
  expect(root.querySelector('[data-testid="alerts-global-total"]')?.textContent).toBe('2');
  expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(globalThis.document.activeElement).toBe(select);
  fleet.install([{ ...vehicles[0]!, vehicleId: '!', eventId: '!' }, ...vehicles]);
  await fixture.whenStable();
  expect(select.value).toBe(JSON.stringify('A'));
  expect(globalThis.document.activeElement).toBe(select);
  root.querySelector<HTMLButtonElement>('.filter button')!.click();
  await fixture.whenStable();
  expect(select.value).toBe('all');
  expect(globalThis.document.activeElement).toBe(select);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
});

it('selección previa con HTML, NUL y sustituta es texto completo; una base recuperada ausente no cambia el ID', async () => {
  const { fixture, root, monitor, fleet, alerts } = setup();
  const id = '<img src=x onerror=alert(1)>\u0000\ud800' + 'x'.repeat(10000);
  const base = {
    eventId: 'selected',
    vehicleId: id,
    observedAt: '2026-01-01T18:00:00Z',
    latitude: 4,
    longitude: -74,
    speedKph: 81,
  };
  fleet.install([{ ...base, ignitionOn: true, status: 'MOVING' }]);
  alerts.install([{ ...base, type: 'OVERSPEED' }]);
  alerts.selectVehicle(id);
  monitor.hasBase.set(true);
  monitor.phase.set('live');
  await fixture.whenStable();
  const select = root.querySelector('select')!;
  expect(select.value).toBe(JSON.stringify(id));
  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('.filter code')?.textContent).toBe(formatIdentity(id));
  fleet.install([
    { ...base, eventId: 'replacement', vehicleId: 'B', ignitionOn: true, status: 'MOVING' },
  ]);
  alerts.install([{ ...base, eventId: 'replacement', vehicleId: 'B', type: 'OVERSPEED' }]);
  monitor.phase.set('reconnecting');
  await fixture.whenStable();
  expect(select.value).toBe(JSON.stringify(id));
  expect(root.textContent).toContain('ya no aparece');
  expect(root.textContent).toContain('Este vehículo no tiene alertas');
  expect(root.textContent).toContain('pueden estar desactualizadas');
  expect(root.querySelector('[data-testid="alerts-global-total"]')?.textContent).toBe('1');
});
it('la acción conserva ambos IDs originales al abrir el historial de una alerta', async () => {
  const { fixture, root, monitor, detail, router, alerts } = setup();
  monitor.hasBase.set(true);
  monitor.phase.set('live');
  const alert = {
    eventId: 'late\u0000',
    vehicleId: 'V\ud800',
    observedAt: '2026-01-01T05:00:00Z',
    latitude: 4,
    longitude: -74,
    speedKph: 95,
    type: 'OVERSPEED' as const,
  };
  alerts.install([alert]);
  await fixture.whenStable();
  expect(root.textContent).toContain('01/01/2026 00:00:00 (Bogotá)');
  expect(root.textContent).toContain('95');
  root.querySelector('button')!.click();
  await fixture.whenStable();
  expect(detail.select).toHaveBeenCalledWith(alert.vehicleId, alert.eventId);
  expect(router.navigateByUrl).toHaveBeenCalledWith('/');
});
