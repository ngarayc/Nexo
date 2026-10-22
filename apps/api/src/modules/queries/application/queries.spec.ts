import { expect, it, vi } from 'vitest';
import {
  DomainQueries,
  InvalidQuery,
  readSearch,
  readVehicleId,
  readHistoryBody,
} from './queries.js';
import type { ReadModel } from './queries.js';
import type { EventView } from '../../telemetry/public.js';

const event = (vehicleId: string, ignitionOn: boolean, speedKph: number): EventView => ({
  eventId: 'event-' + vehicleId,
  vehicleId,
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph,
  ignitionOn,
});
function model(events: readonly EventView[] = []): ReadModel {
  return {
    fleet: vi.fn().mockResolvedValue(events),
    history: vi.fn().mockResolvedValue(events),
    alerts: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue({ vehicles: events, alerts: [] }),
  };
}
it('búsqueda literal preserva identidades y resumen global incluso al filtrar a cero', async () => {
  const queries = new DomainQueries(
    model([event('A_%', false, 90), event('b', true, 0), event('B', true, 1)]),
    'instance',
  );
  const result = await queries.fleet('a_%');
  expect(result.items.map((v) => v.vehicleId)).toEqual(['A_%']);
  expect(result).toMatchObject({
    total: 1,
    overallTotal: 3,
    summary: { OFF: 1, STOPPED: 1, MOVING: 1 },
  });
  expect((await queries.fleet('b')).items.map((v) => v.vehicleId)).toEqual(['b', 'B']);
  expect(await queries.fleet('unknown')).toMatchObject({ total: 0, overallTotal: 3 });
});
it('ausencia de búsqueda y cadena vacía conservan toda la colección', async () => {
  const queries = new DomainQueries(model([event('A', true, 1)]), 'instance');
  expect(await queries.fleet()).toEqual(await queries.fleet(''));
  expect(await queries.fleet()).toMatchObject({ total: 1, overallTotal: 1 });
});
it('consulta exacta no recorta ni normaliza y desconocido conserva vacío explícito', async () => {
  const source = model();
  const id = ' A\u0000\ud800 ';
  expect(await new DomainQueries(source, 'instance').history(id)).toEqual({
    vehicleId: id,
    items: [],
    total: 0,
  });
  expect(source.history).toHaveBeenCalledExactlyOnceWith(id);
});
it('snapshot usa el puerto coherente y conserva instancia/versión sin consultar colecciones por separado', async () => {
  const source = model([event('A', true, 1)]);
  const snapshot = await new DomainQueries(source, 'instance').snapshot();
  expect(snapshot).toMatchObject({
    instanceId: 'instance',
    schemaVersion: 1,
    vehicles: { total: 1 },
    alerts: { total: 0, overallTotal: 0 },
  });
  expect(source.snapshot).toHaveBeenCalledOnce();
  expect(source.fleet).not.toHaveBeenCalled();
  expect(source.alerts).not.toHaveBeenCalled();
});
it('errores del modelo se propagan y parámetros no string o cuerpos incorrectos no se convierten en vacío', async () => {
  const source = model();
  source.history = vi.fn().mockRejectedValue(new Error('unavailable'));
  await expect(new DomainQueries(source, 'instance').history('A')).rejects.toThrow('unavailable');
  for (const value of [[], ['a'], {}, null, 2])
    expect(() => readSearch(value)).toThrow(InvalidQuery);
  for (const value of [undefined, '', 2, null])
    expect(() => readVehicleId(value)).toThrow(InvalidQuery);
  for (const value of [[], null, {}, { vehicleId: 2 }, { vehicleId: '' }])
    expect(() => readHistoryBody(value)).toThrow(InvalidQuery);
  expect(
    readHistoryBody(JSON.parse('{"vehicleId":"\\ud800","__proto__":{"vehicleId":"wrong"}}')),
  ).toBe('\ud800');
  expect(readSearch(undefined)).toBe('');
});
