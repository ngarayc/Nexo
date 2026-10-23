import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { OriginalJson, validateEvent } from '../../../telemetry/public.js';
import { changeMessage, changeFrame } from '../../../telemetry/application/change-message.js';
import { storedFrame } from './stored-frame.js';

function fixture() {
  const validated = validateEvent(
    OriginalJson.parse(
      JSON.stringify({
        eventId: 'event\n\rdata:hostile\u0000\ud800',
        vehicleId: 'vehicle',
        observedAt: '2026-01-01T01:00:00.1234567890001+01:00',
        latitude: 4,
        longitude: -74,
        speedKph: 81,
        ignitionOn: true,
      }),
    ),
  );
  if (!validated.valid) throw new Error('Fixture inválido.');
  return validated.event;
}
it('los tres tipos originales conservan trama/tamaño exactos y un ID libre no inyecta líneas SSE', () => {
  const event = fixture();
  for (const type of ['telemetry.accepted', 'vehicle.updated', 'alert.created'] as const) {
    const message = changeMessage(type, event, randomUUID());
    const frame = changeFrame(message);
    const metadata = {
      messageId: message.messageId,
      type,
      schemaVersion: 1,
      frameBytes: Buffer.byteLength(frame),
    };
    expect(storedFrame(metadata, JSON.stringify(message))).toBe(frame);
    expect(frame.split('\n')).toHaveLength(5);
    expect(message.observedAt).toBe('2026-01-01T00:00:00.1234567890001Z');
  }
});
it('payload, identidad, versión, estado, alerta o tamaño incompatibles nunca se presentan como trama válida', () => {
  const message = changeMessage('vehicle.updated', fixture(), randomUUID());
  const metadata = {
    messageId: message.messageId,
    type: message.type,
    schemaVersion: 1,
    frameBytes: Buffer.byteLength(changeFrame(message)),
  };
  for (const invalid of [
    {},
    { ...message, messageId: randomUUID() },
    { ...message, schemaVersion: 2 },
    { ...message, data: { ...message.data, state: 'OFF' } },
    { ...message, data: { ...message.data, unknown: 'extra' } },
    { ...message, observedAt: '2026-01-01T00:00:01Z' },
  ])
    expect(() => storedFrame(metadata, JSON.stringify(invalid))).toThrow();
  expect(() =>
    storedFrame({ ...metadata, frameBytes: metadata.frameBytes + 1 }, JSON.stringify(message)),
  ).toThrow('OUTBOX_PAYLOAD_INVALID');
  const alert = changeMessage('alert.created', fixture(), randomUUID());
  const wrong = { ...alert, data: { ...alert.data, speedKph: 80 } };
  expect(() =>
    storedFrame(
      { messageId: alert.messageId, type: alert.type, schemaVersion: 1, frameBytes: 1 },
      JSON.stringify(wrong),
    ),
  ).toThrow('OUTBOX_PAYLOAD_INVALID');
});

it('conserva el original exacto y lee la trama histórica sin metadato sin reescribir sus bytes', () => {
  const message = changeMessage('telemetry.accepted', fixture(), randomUUID());
  const { observedAtOriginal, ...legacyData } = message.data;
  expect(observedAtOriginal).toBe('2026-01-01T01:00:00.1234567890001+01:00');
  const legacy = { ...message, data: legacyData };
  const frame = changeFrame(legacy);
  expect(
    storedFrame(
      {
        messageId: message.messageId,
        type: message.type,
        schemaVersion: 1,
        frameBytes: Buffer.byteLength(frame),
      },
      JSON.stringify(legacy),
    ),
  ).toBe(frame);
  for (const original of [null, 1, 'not-a-date', '2026-01-01T00:00:00.1234567890002Z']) {
    const payload = JSON.stringify({
      ...message,
      data: { ...message.data, observedAtOriginal: original },
    });
    const candidate = `id:${message.messageId}\nevent:${message.type}\ndata:${payload}\n\n`;
    expect(() =>
      storedFrame(
        {
          messageId: message.messageId,
          type: message.type,
          schemaVersion: 1,
          frameBytes: Buffer.byteLength(candidate),
        },
        payload,
      ),
    ).toThrow('OUTBOX_PAYLOAD_INVALID');
  }
});
