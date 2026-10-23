import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { VehicleHistory } from './vehicle-history';
import type { EventView } from '@nexo/contracts';

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

it('la acción nativa emite el ID original y expresa la selección sin usar el índice de la fila', async () => {
  const fixture = TestBed.createComponent(VehicleHistory);
  const id = 'E\u0000\ud800';
  fixture.componentRef.setInput('items', [
    {
      eventId: id,
      vehicleId: 'V',
      observedAt: '2026-01-01T05:00:00Z',
      latitude: 14.6,
      longitude: -90.5,
      speedKph: 81,
      ignitionOn: true,
    },
  ]);
  const selected: string[] = [];
  fixture.componentInstance.selectEvent.subscribe((eventId) => selected.push(eventId));
  await fixture.whenStable();
  const button = (fixture.nativeElement as HTMLElement).querySelector(
    'tbody button',
  )! as HTMLButtonElement;
  expect(button.getAttribute('aria-pressed')).toBe('false');
  button.click();
  expect(selected).toEqual([id]);
  fixture.componentRef.setInput('highlighted', id);
  await fixture.whenStable();
  expect(button.getAttribute('aria-pressed')).toBe('true');
});

it('la selección expone original y UTC completos, sin usar la etiqueta visual para identificar el evento', async () => {
  const fixture = TestBed.createComponent(VehicleHistory);
  const base = { vehicleId: 'V', latitude: 4, longitude: -74, speedKph: 0, ignitionOn: true };
  const events: readonly EventView[] = [
    {
      ...base,
      eventId: 'a',
      observedAt: '2026-01-01T05:00:00.1234567890001Z',
      observedAtOriginal: '2026-01-01T00:00:00.123456789000100-05:00',
    },
    { ...base, eventId: 'b', observedAt: '2026-01-01T05:00:00.1234567890002Z' },
  ];
  fixture.componentRef.setInput('items', events);
  fixture.componentRef.setInput('highlighted', 'a');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('summary')?.textContent).toBe('Inspeccionar fecha exacta');
  expect(root.querySelector('[data-testid="observation-original-time"]')?.textContent).toBe(
    events[0]!.observedAtOriginal,
  );
  expect(root.querySelector('[data-testid="observation-utc-time"]')?.textContent).toBe(
    events[0]!.observedAt,
  );
  fixture.componentRef.setInput('highlighted', 'b');
  await fixture.whenStable();
  expect(root.querySelector('[data-testid="observation-utc-time"]')?.textContent).toBe(
    events[1]!.observedAt,
  );
  expect(root.querySelector('[data-testid="observation-original-time"]')?.textContent).toBe(
    'No disponible en esta notificación histórica.',
  );
});
