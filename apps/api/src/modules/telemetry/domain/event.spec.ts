import { describe, expect, it } from 'vitest';
import { OriginalJson } from './original-json.js';
import {
  validateEvent,
  sameEventPayload,
  compareEventOrder,
  vehicleState,
  isOverspeed,
  eventView,
} from './event.js';
import type { TelemetryEvent } from './event.js';

const base = {
  eventId: 'E-X',
  vehicleId: 'V-X',
  observedAt: '2026-10-18T10:05:00.1234567891Z',
  latitude: 4.6,
  longitude: -74.1,
  speedKph: 0,
  ignitionOn: true,
};
function event(overrides: Record<string, unknown> = {}, extra = ''): TelemetryEvent {
  const known = JSON.stringify({ ...base, ...overrides });
  const result = validateEvent(OriginalJson.parse(known.slice(0, -1) + extra + '}'));
  if (!result.valid) throw new Error(`Fixture de evento inválido: ${result.reason}`);
  return result.event;
}

describe('evento estricto y reglas de clasificación independientes del transporte', () => {
  it.each(['null', '[]', '1', '"text"'])('rechaza una posición no objeto: %s', (source) => {
    expect(validateEvent(OriginalJson.parse(source))).toEqual({
      valid: false,
      eventId: null,
      reason: 'INVALID_EVENT',
    });
  });
  it.each([
    [{ eventId: 1 }, 'INVALID_EVENT_ID'],
    [{ eventId: '' }, 'INVALID_EVENT_ID'],
    [{ vehicleId: '' }, 'INVALID_VEHICLE_ID'],
    [{ observedAt: '2026-02-30T10:05:00Z' }, 'INVALID_OBSERVED_AT'],
    [{ observedAt: '2026-10-18T10:05:00' }, 'INVALID_OBSERVED_AT'],
    [{ latitude: 91 }, 'INVALID_LATITUDE'],
    [{ latitude: '4.6' }, 'INVALID_LATITUDE'],
    [{ longitude: -181 }, 'INVALID_LONGITUDE'],
    [{ speedKph: -1 }, 'INVALID_SPEED'],
    [{ speedKph: '80' }, 'INVALID_SPEED'],
    [{ ignitionOn: 1 }, 'INVALID_IGNITION'],
  ])('rechaza tipo/rango sin reparar', (overrides, reason) => {
    const result = validateEvent(OriginalJson.parse(JSON.stringify({ ...base, ...overrides })));
    expect(result).toMatchObject({ valid: false, reason });
  });
  it('conserva la prioridad del motivo y no usa un ID inválido numérico como correlación', () => {
    expect(
      validateEvent(
        OriginalJson.parse(JSON.stringify({ ...base, eventId: 1, latitude: 91, speedKph: -1 })),
      ),
    ).toEqual({ valid: false, eventId: null, reason: 'INVALID_EVENT_ID' });
    expect(
      validateEvent(OriginalJson.parse(JSON.stringify({ ...base, latitude: 91, speedKph: -1 }))),
    ).toEqual({ valid: false, eventId: 'E-X', reason: 'INVALID_LATITUDE' });
  });
  it.each([
    ['latitude', 'INVALID_LATITUDE'],
    ['longitude', 'INVALID_LONGITUDE'],
    ['speedKph', 'INVALID_SPEED'],
  ])('rechaza overflow numérico en %s preservando la sintaxis válida', (field, reason) => {
    const source = JSON.stringify(base).replace(
      new RegExp(`"${field}":[^,}]+`),
      `"${field}":1e400`,
    );
    expect(validateEvent(OriginalJson.parse(source))).toMatchObject({ valid: false, reason });
  });
  it('no recorta IDs, conserva sustitutos/nulo y admite límites GPS/velocidad cero', () => {
    const value = event({
      eventId: ' \u0000\ud800 ',
      vehicleId: ' ',
      latitude: -90,
      longitude: 180,
      speedKph: 0,
    });
    expect(value.eventId).toBe(' \u0000\ud800 ');
    expect(value.vehicleId).toBe(' ');
    expect(Object.isFrozen(value)).toBe(true);
  });
  it('igualdad aplica instante/extras exactos; campos conocidos no contaminan extras', () => {
    const a = event({}, ',"extra":1e400,"__proto__":{"x":1}');
    const b = event(
      { observedAt: '2026-10-18T05:05:00.123456789100-05:00' },
      ',"__proto__":{"x":1.0},"extra":10e399',
    );
    expect(sameEventPayload(a, b)).toBe(true);
    const different = event({}, ',"extra":1e401,"__proto__":{"x":1}');
    expect(sameEventPayload(a, different)).toBe(false);
    expect(a.extra.property('eventId')).toBeUndefined();
    expect(a.extra.property('__proto__')?.property('x')?.numberValue).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'x')).toBe(false);
    expect(
      sameEventPayload(event({}, ',"n":9007199254740992'), event({}, ',"n":9007199254740993')),
    ).toBe(false);
    expect(sameEventPayload(event(), event({}, ',"extra":null'))).toBe(false);
  });
  it('ordena por instante y después puntos de código; llegada y UTF-16 no deciden latest', () => {
    const earlier = event({ observedAt: '2026-10-18T10:05:00.1234567890Z', eventId: 'Z' });
    const a = event({ eventId: '\ue000' }),
      b = event({ eventId: '\u{10000}' });
    expect(compareEventOrder(earlier, a)).toBe(-1);
    expect(compareEventOrder(a, b)).toBe(-1);
    expect(compareEventOrder(b, a)).toBe(1);
    expect(compareEventOrder(a, a)).toBe(0);
  });
  it.each([
    [false, 95, 'OFF', true],
    [true, 0, 'STOPPED', false],
    [true, 80, 'MOVING', false],
    [true, 81, 'MOVING', true],
  ])('estado y exceso son reglas independientes', (ignitionOn, speedKph, state, alert) => {
    const value = event({ ignitionOn, speedKph });
    expect(vehicleState(value)).toBe(state);
    expect(isOverspeed(value)).toBe(alert);
  });
  it('la vista añade el original real a los siete campos, con UTC exacto y sin extras arbitrarios', () => {
    const value = event(
      { observedAt: '2026-10-18T05:05:00.1234567891-05:00' },
      ',"privateExtra":1e400',
    );
    expect(eventView(value)).toEqual({
      ...base,
      observedAtOriginal: '2026-10-18T05:05:00.1234567891-05:00',
    });
    expect(Object.keys(eventView(value)).length).toBe(8);
  });
  it('un extra llamado observedAtOriginal no sustituye la fecha realmente recibida', () => {
    const value = event({}, ',"observedAtOriginal":"forged"');
    expect(eventView(value).observedAtOriginal).toBe(base.observedAt);
    expect(value.extra.property('observedAtOriginal')?.stringValue).toBe('forged');
  });
});
