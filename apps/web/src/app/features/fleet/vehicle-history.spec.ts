import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { VehicleHistory } from './vehicle-history';

it('identifica y enfoca la observación seleccionada por ID sin depender de posición o CSS', async () => {
  const fixture = TestBed.createComponent(VehicleHistory);
  const event = {
    eventId: 'late\u0000',
    vehicleId: 'A',
    observedAt: '2026-01-01T00:00:00Z',
    latitude: 4,
    longitude: -74,
    speedKph: 95,
    ignitionOn: true,
  };
  fixture.componentRef.setInput('items', [event]);
  fixture.componentRef.setInput('highlighted', event.eventId);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const row = root.querySelector('tbody tr')!;
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(row.textContent).toContain('Observación seleccionada');
  expect(fixture.componentInstance.focusEvent(event.eventId)).toBe(true);
  expect(document.activeElement).toBe(row);
  expect(fixture.componentInstance.focusEvent('unknown')).toBe(false);
});
