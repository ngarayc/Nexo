import { describe, expect, it } from 'vitest';
import {
  readSnapshot,
  readHistory,
  readDomainFrame,
  readStreamControl,
  TelemetryProtocolError,
  CaptureCapacityError,
  captureLimits,
} from './telemetry-contract';

const instanceId = '00000000-0000-4000-8000-000000000001';
const messageId = '00000000-0000-4000-8000-000000000002';
const event = {
  eventId: 'E-🚐\u0000\ud800',
  vehicleId: 'vehículo',
  observedAt: '2026-01-01T00:00:00.1234567890001Z',
  latitude: 4,
  longitude: -74,
  speedKph: 81,
  ignitionOn: true,
};
function snapshot() {
  const observation = {
    eventId: event.eventId,
    vehicleId: event.vehicleId,
    observedAt: event.observedAt,
    latitude: event.latitude,
    longitude: event.longitude,
    speedKph: event.speedKph,
  };
  return {
    schemaVersion: 1,
    instanceId,
    vehicles: {
      items: [{ ...event, status: 'MOVING' }],
      total: 1,
      overallTotal: 1,
      summary: { OFF: 0, MOVING: 1, STOPPED: 0 },
    },
    alerts: { items: [{ ...observation, type: 'OVERSPEED' }], total: 1, overallTotal: 1 },
  };
}
function message(type: string, data: object) {
  return {
    messageId,
    schemaVersion: 1,
    type,
    eventId: event.eventId,
    vehicleId: event.vehicleId,
    observedAt: event.observedAt,
    data,
  };
}

describe('frontera de datos públicos de telemetría', () => {
  it('snapshot conserva identidad y precisión, verifica totales y devuelve vistas inmutables', () => {
    const result = readSnapshot(JSON.parse(JSON.stringify(snapshot())));
    expect(result.vehicles.items[0]?.eventId).toBe(event.eventId);
    expect(result.vehicles.items[0]?.observedAt).toBe(event.observedAt);
    expect(result.alerts.total).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.vehicles.items)).toBe(true);
    expect(Object.isFrozen(result.vehicles.items[0])).toBe(true);
  });
  it('un vacío completo es válido; falta, versión, datos o contadores incoherentes se rechazan', () => {
    expect(
      readSnapshot({
        schemaVersion: 1,
        instanceId,
        vehicles: {
          items: [],
          total: 0,
          overallTotal: 0,
          summary: { OFF: 0, MOVING: 0, STOPPED: 0 },
        },
        alerts: { items: [], total: 0, overallTotal: 0 },
      }).vehicles.total,
    ).toBe(0);
    const base = snapshot();
    for (const invalid of [
      null,
      {},
      { ...base, schemaVersion: 2 },
      { ...base, schemaVersion: '1' },
      { ...base, vehicles: { ...base.vehicles, total: 0 } },
      {
        ...base,
        vehicles: {
          ...base.vehicles,
          items: [...base.vehicles.items, ...base.vehicles.items],
          total: 2,
          overallTotal: 2,
        },
      },
      { ...base, vehicles: { ...base.vehicles, summary: { OFF: 1, MOVING: 0, STOPPED: 0 } } },
      {
        ...base,
        vehicles: { ...base.vehicles, items: [{ ...event, latitude: 91, status: 'MOVING' }] },
      },
      {
        ...base,
        vehicles: { ...base.vehicles, items: [{ ...event, speedKph: '81', status: 'MOVING' }] },
      },
      { ...base, vehicles: { ...base.vehicles, items: [{ ...event, status: 'OFF' }] } },
      { ...base, alerts: { ...base.alerts, items: [{ ...base.alerts.items[0], speedKph: 80 }] } },
      {
        ...base,
        alerts: { ...base.alerts, items: [{ ...base.alerts.items[0], vehicleId: 'otra' }] },
      },
    ])
      expect(() => readSnapshot(invalid)).toThrow(TelemetryProtocolError);
  });
  it('los tres cambios mantienen sobre/data y miden la trama UTF-8 completa', () => {
    for (const [type, data] of [
      ['telemetry.accepted', event],
      ['vehicle.updated', { ...event, state: 'MOVING' }],
      ['alert.created', { ...event, type: 'OVERSPEED' }],
    ] as const) {
      const raw = JSON.stringify(message(type, data));
      const result = readDomainFrame(type, messageId, raw);
      expect(result.change.eventId).toBe(event.eventId);
      expect(result.change.data.observedAt).toBe(event.observedAt);
      expect(result.bytes).toBe(new Blob([`id:${messageId}\nevent:${type}\ndata:${raw}\n\n`]).size);
    }
  });
  it('incompatibilidad de identidad, estado o JSON no se aplica como cambio parcial', () => {
    const base = message('vehicle.updated', { ...event, state: 'MOVING' });
    for (const invalid of [
      { ...base, messageId: instanceId },
      { ...base, eventId: 'otra' },
      { ...base, schemaVersion: 2 },
      { ...base, data: { ...event, state: 'OFF' } },
      { ...base, data: { ...event, state: 'MOVING', extra: true } },
      {
        ...base,
        data: { ...event, state: 'MOVING', observedAt: '2025-12-31T19:00:00.1234567890001-05:00' },
      },
    ])
      expect(() => readDomainFrame('vehicle.updated', messageId, JSON.stringify(invalid))).toThrow(
        TelemetryProtocolError,
      );
    expect(() => readDomainFrame('vehicle.updated', messageId, '{')).toThrow(
      TelemetryProtocolError,
    );
    expect(() => readDomainFrame('other', messageId, '{}')).toThrow(TelemetryProtocolError);
  });
  it('una trama que supera el presupuesto se rechaza antes de parsear contenido', () => {
    expect(() =>
      readDomainFrame('telemetry.accepted', messageId, ' '.repeat(captureLimits.bytes)),
    ).toThrow(CaptureCapacityError);
  });
  it('controles comprueban versión, instancia y cadencia sin depender de Last-Event-ID', () => {
    for (const control of [
      { type: 'stream.ready', schemaVersion: 1, instanceId, heartbeatMilliseconds: 15000 },
      { type: 'stream.heartbeat', schemaVersion: 1, instanceId },
      { type: 'stream.resync-required', schemaVersion: 1, instanceId, reason: 'CLIENT_CAPACITY' },
    ])
      expect(readStreamControl(control.type, JSON.stringify(control)).type).toBe(control.type);
    expect(() =>
      readStreamControl(
        'stream.ready',
        JSON.stringify({
          type: 'stream.ready',
          schemaVersion: 1,
          instanceId,
          heartbeatMilliseconds: 1,
        }),
      ),
    ).toThrow(TelemetryProtocolError);
    expect(() => readStreamControl('stream.heartbeat', '{')).toThrow(TelemetryProtocolError);
  });
  it('historial conserva vehículo exacto y rechaza respuesta cruzada o eventos duplicados', () => {
    const input = { vehicleId: event.vehicleId, items: [event], total: 1 };
    expect(readHistory(input, event.vehicleId).items[0]?.eventId).toBe(event.eventId);
    expect(() => readHistory(input, 'otro')).toThrow(TelemetryProtocolError);
    expect(() =>
      readHistory({ ...input, items: [event, event], total: 2 }, event.vehicleId),
    ).toThrow(TelemetryProtocolError);
    expect(() => readHistory({ ...input, total: 0 }, event.vehicleId)).toThrow(
      TelemetryProtocolError,
    );
  });

  it('un mismo eventId global no puede representar el último estado de dos vehículos', () => {
    const base = snapshot();
    expect(() =>
      readSnapshot({
        ...base,
        vehicles: {
          ...base.vehicles,
          items: [...base.vehicles.items, { ...base.vehicles.items[0], vehicleId: 'otra' }],
          total: 2,
          overallTotal: 2,
          summary: { MOVING: 2, OFF: 0, STOPPED: 0 },
        },
      }),
    ).toThrow(TelemetryProtocolError);
  });
});
