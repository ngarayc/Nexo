import { describe, expect, it } from 'vitest';
import { replayConfigurationFingerprint } from './replay-material.js';
const config = () => ({
  database: { host: 'db', port: 5432, database: 'nexo' },
  publicOrigin: 'http://localhost:8080',
  demoEnabled: true,
  ingestionLimits: { bodyBytes: 2097152, events: 10000 },
  server: { host: '0.0.0.0', port: 3000 },
});
describe('identidad del perfil no secreto de la reproducción', () => {
  it('huella estable por propiedades explícitas, sin arrastrar credenciales adicionales', () => {
    const first = { ...config(), secret: 'synthetic-private-A' },
      second = { secret: 'synthetic-private-B', ...config() };
    expect(replayConfigurationFingerprint(first)).toEqual(replayConfigurationFingerprint(second));
    expect(replayConfigurationFingerprint(first)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('un límite efectivo o destino distinto cambia la huella', () => {
    const first = config(),
      second = config();
    second.ingestionLimits.events--;
    expect(replayConfigurationFingerprint(first)).not.toEqual(
      replayConfigurationFingerprint(second),
    );
    second.ingestionLimits = first.ingestionLimits;
    second.database.host = 'other-db';
    expect(replayConfigurationFingerprint(first)).not.toEqual(
      replayConfigurationFingerprint(second),
    );
  });
  it('rechaza un perfil incompleto o no canónico en vez de identificarlo como válido', () => {
    const invalid = config();
    invalid.publicOrigin = 'http://untrusted.invalid';
    expect(() => replayConfigurationFingerprint(invalid)).toThrow('No se pudo identificar');
  });
});
