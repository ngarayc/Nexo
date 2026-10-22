import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readReplayCommand, replayCommandDocument } from './command.js';
import { ReplayInputError } from './replay.js';
const original = {
  commandId: randomUUID(),
  instanceId: randomUUID(),
  expectedControlVersion: 0,
  runId: null,
  action: 'start',
};
describe('órdenes estrictas del reproductor compartido', () => {
  it('normaliza claves/UUID sin incorporar campos extra o cambiar semántica de la intención', () => {
    const command = readReplayCommand({ ...original, commandId: original.commandId.toUpperCase() });
    expect(command.commandId).toBe(original.commandId);
    expect(Object.isFrozen(command)).toBe(true);
    expect(replayCommandDocument(command)).toBe(
      replayCommandDocument(
        readReplayCommand(Object.fromEntries(Object.entries(original).reverse())),
      ),
    );
  });
  it.each(['pause', 'resume', 'restart', 'finishVerification'])(
    'acción%s exige ejecución y conserva su identidad',
    (action) => {
      const runId = randomUUID();
      expect(readReplayCommand({ ...original, runId, action })).toMatchObject({ runId, action });
      expect(() => readReplayCommand({ ...original, action })).toThrow(ReplayInputError);
    },
  );
  it.each([
    null,
    [],
    true,
    'start',
    {},
    { ...original, runId: randomUUID() },
    { ...original, action: ['start'] },
    { ...original, expectedControlVersion: '0' },
    { ...original, expectedControlVersion: 0.1 },
    { ...original, expectedControlVersion: -1 },
    { ...original, expectedControlVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...original, intervalMs: '750' },
    { ...original, intervalMs: undefined },
    { ...original, intervalMs: 99 },
    { ...original, intervalMs: 5001 },
    { ...original, headers: { authorization: 'synthetic-marker' } },
    { ...original, url: 'http://untrusted.invalid' },
    { ...original, commandId: 'invalid' },
  ])('rechaza orden de forma/tipo/permiso incompatible #%#', (value) => {
    expect(() => readReplayCommand(value)).toThrow(ReplayInputError);
  });
  it('intervalo solo en inicio/reinicio/reanudación y dentro del rango entero', () => {
    for (const action of ['start', 'restart', 'resume'])
      for (const intervalMs of [100, 750, 5000])
        expect(
          readReplayCommand({
            ...original,
            action,
            runId: action === 'start' ? null : randomUUID(),
            intervalMs,
          }).intervalMs,
        ).toBe(intervalMs);
    for (const action of ['pause', 'finishVerification'])
      expect(() =>
        readReplayCommand({ ...original, action, runId: randomUUID(), intervalMs: 750 }),
      ).toThrow(ReplayInputError);
  });
});
