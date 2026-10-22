import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, it, vi } from 'vitest';
import { AlertsPage } from './alerts-page';
import { AlertsFacade } from './alerts-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import type { LivePhase } from '../live-monitoring/live-monitor';
import { VehicleDetailFacade } from '../fleet/vehicle-detail-facade';

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
  return { fixture, root, monitor, detail, router, alerts: TestBed.inject(AlertsFacade) };
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
