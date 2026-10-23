import { describe, expect, it } from 'vitest';
import type { EventView } from '@nexo/contracts';
import { demoGeofence, geofenceChanges, geofenceStatus } from './geofence';

function event(eventId: string, observedAt: string, inside: boolean, vehicleId = 'V'): EventView {
  return {
    eventId,
    vehicleId,
    observedAt,
    latitude: inside ? 14.612 : 14.62,
    longitude: inside ? -90.538 : -90.52,
    speedKph: 0,
    ignitionOn: true,
  };
}
describe('geocerca fija de consulta', () => {
  it('distingue las dos posiciones sin invertir latitud y longitud', () => {
    expect(geofenceStatus({ latitude: 14.612, longitude: -90.538 })).toBe('inside');
    expect(geofenceStatus({ latitude: 14.62, longitude: -90.52 })).toBe('outside');
    expect(geofenceStatus({ latitude: 90, longitude: 0 })).toBe('outside');
  });
  it('incluye sus cuatro bordes y esquinas; el punto inmediato exterior queda fuera', () => {
    for (const latitude of [demoGeofence.south, demoGeofence.north])
      for (const longitude of [demoGeofence.west, demoGeofence.east])
        expect(geofenceStatus({ latitude, longitude })).toBe('inside');
    expect(geofenceStatus({ latitude: 14.612, longitude: demoGeofence.west })).toBe('inside');
    expect(geofenceStatus({ latitude: demoGeofence.south, longitude: -90.538 })).toBe('inside');
    expect(geofenceStatus({ latitude: demoGeofence.south - 0.000001, longitude: -90.538 })).toBe(
      'outside',
    );
    expect(geofenceStatus({ latitude: 14.612, longitude: demoGeofence.east + 0.000001 })).toBe(
      'outside',
    );
  });
  it('una coordenada inválida no se clasifica como fuera', () => {
    for (const latitude of [NaN, Infinity, 109.1])
      expect(geofenceStatus({ latitude, longitude: -90.538 })).toBe('unknown');
    expect(geofenceStatus({ latitude: 14.612, longitude: -181 })).toBe('unknown');
  });
  it('reconstruye el cambio observado con orden exacto, sin mutar ni inferir un cruce inicial', () => {
    const before = event('earlier', '2026-01-01T00:00:00.000000000001Z', false);
    const after = event('later', '2026-01-01T00:00:00.000000000002Z', true);
    const input = Object.freeze([after, before]);
    expect(geofenceChanges([before])).toEqual([]);
    expect(geofenceChanges(input)).toEqual([{ before, after, kind: 'entry' }]);
    expect(input).toEqual([after, before]);
    expect(geofenceChanges([before, after, after])).toHaveLength(1);
  });
  it('separa vehículos y no conecta un intervalo con posición desconocida', () => {
    const outside = event('a', '2026-01-01T00:00:00Z', false);
    const inside = event('c', '2026-01-01T00:00:02Z', true);
    expect(geofenceChanges([outside, { ...inside, vehicleId: 'OTHER' }])).toEqual([]);
    const invalid = { ...event('b', '2026-01-01T00:00:01Z', true), latitude: NaN };
    expect(geofenceChanges([outside, invalid, inside])).toEqual([]);
    expect(
      geofenceChanges([inside, { ...outside, eventId: 'd', observedAt: '2026-01-01T00:00:03Z' }])[0]
        ?.kind,
    ).toBe('exit');
  });
});
