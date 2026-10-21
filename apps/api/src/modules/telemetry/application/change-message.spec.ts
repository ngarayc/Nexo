import { describe, expect, it } from 'vitest';
import { OriginalJson } from '../domain/original-json.js';
import { validateEvent } from '../domain/event.js';
import { changeFrame, changeMessage } from './change-message.js';

const id = 'a5dd6bd2-355d-4241-a7a8-365439212029';
const result = validateEvent(
  OriginalJson.parse(
    JSON.stringify({
      eventId: 'E\n\nid:intruso\r\ndata:intruso',
      vehicleId: '\u0000\ud800🚐',
      observedAt: '2026-01-01T00:00:00.000000000001Z',
      latitude: 4,
      longitude: -74,
      speedKph: 95,
      ignitionOn: false,
      arbitrary: 'no publicar',
    }),
  ),
);
if (!result.valid) throw new Error('Fixture unitario inválido.');
const event = result.event;

describe('mensajes confirmados y serialización SSE versión 1', () => {
  it('congela datos explícitos y conserva la precisión sin extras arbitrarios', () => {
    const message = changeMessage('vehicle.updated', event, id);
    expect(message.schemaVersion).toBe(1);
    expect(message.observedAt).toBe('2026-01-01T00:00:00.000000000001Z');
    expect(message.data).toMatchObject({ state: 'OFF', speedKph: 95 });
    expect(message.data).not.toHaveProperty('arbitrary');
    expect(Object.isFrozen(message)).toBe(true);
    expect(Object.isFrozen(message.data)).toBe(true);
  });

  it('IDs de telemetría con saltos no pueden inyectar campos o eventos SSE', () => {
    const message = changeMessage('alert.created', event, id);
    const frame = changeFrame(message);
    const lines = frame.split('\n');
    expect(lines.length).toBe(5);
    expect(lines[0]).toBe(`id:${id}`);
    expect(lines[1]).toBe('event:alert.created');
    expect(JSON.parse(lines[2]!.slice(5))).toEqual(message);
    expect(Buffer.byteLength(frame)).toBeGreaterThan(frame.length);
    expect(message.data).toMatchObject({ type: 'OVERSPEED', vehicleId: event.vehicleId });
  });

  it('el ID de trama exige una identidad técnica, no una cadena de productor', () => {
    expect(() => changeMessage('telemetry.accepted', event, 'id\ndata:injection')).toThrow();
  });

  it('la serialización vuelve a comprobar campos de trama al recuperar JSON persistido', () => {
    const message = changeMessage('telemetry.accepted', event, id);
    for (const invalid of [
      { ...message, messageId: 'injection\ndata:intruso' },
      { ...message, type: 'telemetry.accepted\ndata:intruso' },
      { ...message, schemaVersion: 2 },
    ])
      expect(() => changeFrame(JSON.parse(JSON.stringify(invalid)))).toThrow();
  });
});
