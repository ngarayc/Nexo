import { TestBed } from '@angular/core/testing';
import { expect, it, vi } from 'vitest';
import type { EventView } from '@nexo/contracts';
import { VehicleSpeedChart } from './vehicle-speed-chart';
import { SPEED_CHART_FACTORY } from './adapters/speed-chart-factory';
import type { SpeedChartFactory } from './adapters/speed-chart-renderer';

const event: EventView = {
  eventId: 'E<img src=x>',
  vehicleId: 'V',
  observedAt: '2026-01-01T05:00:00Z',
  latitude: 14.6,
  longitude: -90.5,
  speedKph: 81,
  ignitionOn: true,
};
function setup(items: readonly EventView[] = [event]) {
  const renderer = { sync: vi.fn(), destroy: vi.fn() };
  const create: SpeedChartFactory = () => renderer;
  const factory = vi.fn(create);
  TestBed.configureTestingModule({
    imports: [VehicleSpeedChart],
    providers: [{ provide: SPEED_CHART_FACTORY, useValue: factory }],
  });
  const fixture = TestBed.createComponent(VehicleSpeedChart);
  fixture.componentRef.setInput('items', items);
  return { fixture, root: fixture.nativeElement as HTMLElement, factory, renderer };
}
it('vacío no crea un gráfico o una muestra ficticia', async () => {
  const { fixture, root, factory } = setup([]);
  await fixture.whenStable();
  expect(factory).not.toHaveBeenCalled();
  expect(root.textContent).toContain('No hay muestras de velocidad disponibles');
  expect(root.querySelector('.chart')?.hasAttribute('hidden')).toBe(true);
});
it('canvas tiene nombre, descripción y alternativa por historial; el umbral no es una muestra', async () => {
  const { fixture, root, renderer } = setup();
  await fixture.whenStable();
  const canvas = root.querySelector('canvas')!;
  expect(canvas.getAttribute('role')).toBe('img');
  expect(canvas.getAttribute('aria-label')).toContain('km/h');
  expect(canvas.getAttribute('aria-describedby')).toBe('speed-chart-description');
  expect(canvas.textContent).toContain('tabla de historial');
  expect(root.textContent).toContain('Alerta cuando supera 80 km/h');
  expect(renderer.sync).toHaveBeenLastCalledWith([event], null);
});
it('selección conserva ID original, detalle numérico y un solo renderer ante llegada tardía', async () => {
  const { fixture, root, renderer, factory } = setup();
  const selected = vi.fn();
  fixture.componentInstance.selectEvent.subscribe(selected);
  await fixture.whenStable();
  factory.mock.calls[0]![1](event.eventId);
  expect(selected).toHaveBeenCalledWith(event.eventId);
  fixture.componentRef.setInput('selected', event.eventId);
  fixture.componentRef.setInput('items', [
    { ...event, eventId: 'earlier', observedAt: '2026-01-01T04:59:00Z' },
    event,
  ]);
  await fixture.whenStable();
  expect(root.querySelector('.selected-sample')?.textContent).toContain(event.eventId);
  expect(root.querySelector('.selected-sample')?.textContent).toContain('81 km/h');
  expect(root.querySelector('.selected-sample')?.textContent).toContain(
    '01/01/2026 00:00:00 (Bogotá)',
  );
  expect(root.querySelectorAll('img').length).toBe(0);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(renderer.sync.mock.lastCall?.[1]).toBe(event.eventId);
});
it('selección ausente no inventa valores; destruir libera la instancia y listeners del adaptador', async () => {
  const { fixture, root, renderer } = setup();
  await fixture.whenStable();
  fixture.componentRef.setInput('selected', 'absent');
  await fixture.whenStable();
  expect(root.querySelector('.selected-sample')).toBeNull();
  fixture.destroy();
  expect(renderer.destroy).toHaveBeenCalledTimes(1);
});
