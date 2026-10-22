import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import { AccessFacade } from '../../features/access/access-facade';
import { LiveMonitor } from '../../features/live-monitoring/live-monitor';
import type { LivePhase } from '../../features/live-monitoring/live-monitor';
import { FleetFacade } from '../../features/fleet/fleet-facade';

it('carga y error inicial no presentan cero confirmado; recuperación conserva datos señalados y acción accesible', async () => {
  const monitor = {
    phase: signal<LivePhase>('loading'),
    hasBase: signal(false),
    lastSynchronizedAt: signal<number | null>(null),
    reconnect: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [AppShell],
    providers: [
      provideRouter([]),
      {
        provide: AccessFacade,
        useValue: { session: signal(null), pending: signal(false), error: signal('') },
      },
      { provide: LiveMonitor, useValue: monitor },
    ],
  });
  const fixture = TestBed.createComponent(AppShell);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('[data-testid="vehicle-total"]')).toBeNull();
  expect(root.textContent).toContain('confirmemos la primera carga');
  monitor.phase.set('error');
  await fixture.whenStable();
  expect(root.querySelector('[data-testid="vehicle-total"]')).toBeNull();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('Comprueba tu conexión');
  (root.querySelector('button') as HTMLButtonElement).click();
  expect(monitor.reconnect).toHaveBeenCalledTimes(1);
  TestBed.inject(FleetFacade).install([
    {
      eventId: 'e',
      vehicleId: 'v',
      observedAt: '2026-01-01T00:00:00Z',
      latitude: 4,
      longitude: -74,
      speedKph: 0,
      ignitionOn: true,
      status: 'STOPPED',
    },
  ]);
  monitor.hasBase.set(true);
  monitor.phase.set('reconnecting');
  await fixture.whenStable();
  expect(root.querySelector('[data-testid="vehicle-total"]')?.textContent).toBe('1');
  expect(root.querySelector('[role="status"]')?.textContent).toContain('desactualizados');
});
