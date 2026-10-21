import { describe, expect, it, vi } from 'vitest';
import { OriginalJson } from '../domain/original-json.js';
import { validateEvent } from '../domain/event.js';
import { ClassifyTelemetry } from './classify.js';
import type { StoredTelemetry, TelemetryEffects } from './classify.js';

const source = {
  eventId: 'E',
  vehicleId: 'V',
  observedAt: '2026-01-01T00:00:00Z',
  latitude: 4,
  longitude: -74,
  speedKph: 81,
  ignitionOn: true,
};
const input = (extra = {}) => OriginalJson.parse(JSON.stringify({ ...source, ...extra }));
const parsed = validateEvent(input());
if (!parsed.valid) throw new Error('Fixture unitario inválido.');
const stored: StoredTelemetry = { eventPk: 7n, event: parsed.event };
const ports = (): TelemetryEffects => ({
  insert: vi.fn().mockResolvedValue(stored),
  find: vi.fn().mockResolvedValue(stored),
  promoteLatest: vi.fn().mockResolvedValue(true),
  createAlert: vi.fn().mockResolvedValue(undefined),
  append: vi.fn().mockResolvedValue(undefined),
});

describe('clasificación y efectos del evento', () => {
  it('rechaza un registro inválido sin consultar o escribir dominio', async () => {
    const effects = ports();
    expect(await new ClassifyTelemetry().execute(input({ latitude: 91 }), effects)).toEqual({
      outcome: 'rejected',
      reason: 'INVALID_LATITUDE',
    });
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
  });

  it('un duplicado equivalente no crea alertas, proyecciones o mensajes', async () => {
    const effects = ports();
    vi.mocked(effects.insert).mockResolvedValue(undefined);
    expect(
      await new ClassifyTelemetry().execute(
        input({ observedAt: '2025-12-31T19:00:00-05:00' }),
        effects,
      ),
    ).toEqual({ outcome: 'duplicate', eventPk: 7n });
    expect(effects.find).toHaveBeenCalledWith('E');
    expect(effects.promoteLatest).not.toHaveBeenCalled();
    expect(effects.createAlert).not.toHaveBeenCalled();
    expect(effects.append).not.toHaveBeenCalled();
  });

  it('un payload distinto da conflicto explícito y no sobrescribe', async () => {
    const effects = ports();
    vi.mocked(effects.insert).mockResolvedValue(undefined);
    expect(await new ClassifyTelemetry().execute(input({ speedKph: 82 }), effects)).toEqual({
      outcome: 'rejected',
      reason: 'EVENT_ID_CONFLICT',
    });
    expect(effects.promoteLatest).not.toHaveBeenCalled();
    expect(effects.createAlert).not.toHaveBeenCalled();
    expect(effects.append).not.toHaveBeenCalled();
  });

  it('no convierte una relectura ausente después de conflicto en rechazo', async () => {
    const effects = ports();
    vi.mocked(effects.insert).mockResolvedValue(undefined);
    vi.mocked(effects.find).mockResolvedValue(undefined);
    await expect(new ClassifyTelemetry().execute(input(), effects)).rejects.toThrow(
      'No se pudo leer el evento',
    );
    expect(effects.append).not.toHaveBeenCalled();
  });

  it('un tardío con exceso crea historial y alerta sin vehicle.updated', async () => {
    const effects = ports();
    vi.mocked(effects.promoteLatest).mockResolvedValue(false);
    expect(await new ClassifyTelemetry().execute(input(), effects)).toEqual({
      outcome: 'accepted',
      eventPk: 7n,
    });
    expect(effects.createAlert).toHaveBeenCalledOnce();
    expect(vi.mocked(effects.append).mock.calls.map(([type]) => type)).toEqual([
      'telemetry.accepted',
      'alert.created',
    ]);
  });

  it('un error de persistencia conserva el fallo técnico', async () => {
    const effects = ports();
    const failure = new Error('SQL_UNAVAILABLE');
    vi.mocked(effects.promoteLatest).mockRejectedValue(failure);
    await expect(new ClassifyTelemetry().execute(input(), effects)).rejects.toBe(failure);
    expect(effects.createAlert).not.toHaveBeenCalled();
    expect(effects.append).not.toHaveBeenCalled();
  });
});
