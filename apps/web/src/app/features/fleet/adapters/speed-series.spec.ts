import { expect, it } from 'vitest';
import type { EventView } from '@nexo/contracts';
import { speedSeries } from './speed-series';

const event = (eventId: string, observedAt: string, speedKph: number): EventView => ({
  eventId,
  vehicleId: 'V',
  observedAt,
  speedKph,
  latitude: 14.6,
  longitude: -90.5,
  ignitionOn: true,
});
it('vacío carece de muestras inventadas y mantiene una referencia separada de datos', () => {
  const series = speedSeries([]);
  expect(series.samples).toEqual([]);
  expect(Object.isFrozen(series.samples)).toBe(true);
  expect(series.maxY).toBe(80);
});
it('conserva orden, IDs y velocidades originales; el eje representa tiempo transcurrido', () => {
  const first = Object.freeze(event('E\u0000\ud800', '2026-01-01T00:00:00-05:00', 80));
  const second = Object.freeze(event('later', '2026-01-01T05:00:01.5Z', 81));
  const items = Object.freeze([first, second]);
  const series = speedSeries(items);
  expect(series.samples.map((sample) => [sample.x, sample.y])).toEqual([
    [0, 80],
    [1500, 81],
  ]);
  expect(series.samples[0]?.event).toBe(first);
  expect(series.samples[1]?.event).toBe(second);
  expect(items).toEqual([first, second]);
  expect(series.maxY).toBe(81);
});
it('muestras visualmente coincidentes conservan sus instantes exactos e identidades distintas', () => {
  const first = event('a', '2026-01-01T05:00:01.99999999999999999991Z', 80);
  const second = event('b', '2026-01-01T05:00:01.99999999999999999992Z', 80);
  const series = speedSeries([first, second]);
  expect(series.samples).toHaveLength(2);
  expect(series.samples.map((sample) => sample.x)).toEqual([0, 0]);
  expect(series.samples.map((sample) => sample.event.observedAt)).toEqual([
    first.observedAt,
    second.observedAt,
  ]);
  expect(series.samples.map((sample) => sample.event.eventId)).toEqual(['a', 'b']);
});
it('una muestra y extremos finitos no se recortan ni cambian la velocidad recibida', () => {
  const sample = event('maximum', '2026-01-01T05:00:00Z', Number.MAX_VALUE);
  const series = speedSeries([sample]);
  expect(series.samples).toHaveLength(1);
  expect(series.samples[0]?.y).toBe(Number.MAX_VALUE);
  expect(Number.isFinite(series.maxY)).toBe(true);
  expect(Number.isFinite(series.maxX)).toBe(true);
  expect(series.samples[0]?.x).toBe(0);
});
it('un instante inválido no se transforma en vacío o en una muestra de relleno', () => {
  expect(() => speedSeries([event('invalid', 'invalid', 80)])).toThrow(RangeError);
  expect(() =>
    speedSeries([event('valid', '2026-01-01T05:00:00Z', 80), event('invalid', 'invalid', 81)]),
  ).toThrow(RangeError);
});
