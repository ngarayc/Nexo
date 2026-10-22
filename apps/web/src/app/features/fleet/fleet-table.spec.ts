import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import { FleetTable } from './fleet-table';

it('presenta estado, encendido y fecha 24h; seleccionar emite la identidad original completa', async () => {
  const fixture = TestBed.createComponent(FleetTable);
  const vehicleId = 'VEH_\u0000\ud800';
  fixture.componentRef.setInput('items', [
    {
      eventId: 'event',
      vehicleId,
      observedAt: '2026-01-01T05:00:00.000000000001Z',
      latitude: 4,
      longitude: -74,
      speedKph: 0,
      ignitionOn: false,
      status: 'OFF',
    },
  ]);
  const selected = vi.fn();
  fixture.componentInstance.selectVehicle.subscribe(selected);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.textContent).toContain('01/01/2026 00:00:00 (Bogotá)');
  expect(root.textContent).toContain('Apagado');
  expect(root.textContent).toContain('VEH_\\u0000\\ud800');
  const button = root.querySelector('button')!;
  button.click();
  expect(selected).toHaveBeenCalledExactlyOnceWith(vehicleId);
  expect(fixture.componentInstance.focusVehicle(vehicleId)).toBe(true);
  expect(document.activeElement).toBe(button);
  expect(fixture.componentInstance.focusVehicle('missing')).toBe(false);
});
