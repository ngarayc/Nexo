import { describe, expect, it } from 'vitest';
import {
  readObservedInstant,
  compareObservedInstant,
  observedInstantUtc,
} from './observed-instant.js';

describe('instante exacto de observación, calendario y zona', () => {
  it.each([
    ['1970-01-01T00:00:00Z', 0n, ''],
    ['1969-12-31T23:59:59.5Z', -1n, '5'],
    ['1970-01-01T00:00:00.00100Z', 0n, '001'],
    ['1970-01-01T00:00:00.000Z', 0n, ''],
    ['1970-01-01T00:00:00.123456789123400Z', 0n, '1234567891234'],
    ['1969-12-31T23:59:59.9999999999Z', -1n, '9999999999'],
    ['1970-01-01T00:01:00.00000000001+00:01', 0n, '00000000001'],
  ])('normaliza sin pérdida: %s', (input, epochSecond, fraction) => {
    const value = readObservedInstant(input);
    expect(value).toEqual({ original: input, epochSecond, fraction });
    expect(Object.isFrozen(value)).toBe(true);
    expect(compareObservedInstant(value!, readObservedInstant(observedInstantUtc(value!))!)).toBe(
      0,
    );
  });

  it('considera equivalentes offsets con cambio de día/año y ceros decimales', () => {
    const first = readObservedInstant('2026-01-01T00:05:00.100000000000-05:00')!;
    const second = readObservedInstant('2026-01-01T05:05:00.1Z')!;
    const priorYear = readObservedInstant('2025-12-31T23:05:00.100-06:00')!;
    expect(compareObservedInstant(first, second)).toBe(0);
    expect(compareObservedInstant(first, priorYear)).toBe(0);
    expect(observedInstantUtc(first)).toBe('2026-01-01T05:05:00.1Z');
  });

  it('distingue eventos por debajo del nanosegundo, sin Date o coma flotante', () => {
    const first = readObservedInstant('2026-10-18T10:05:00.1234567891Z')!;
    const second = readObservedInstant('2026-10-18T10:05:00.1234567892Z')!;
    expect(compareObservedInstant(first, second)).toBe(-1);
    expect(compareObservedInstant(second, first)).toBe(1);
    expect(observedInstantUtc(first)).toBe('2026-10-18T10:05:00.1234567891Z');
  });

  it.each([
    null,
    2026,
    '',
    '2026-10-18T10:05:00',
    '2026-02-30T10:05:00Z',
    '2025-02-29T10:05:00Z',
    '2026-13-01T10:05:00Z',
    '2026-10-18T25:00:00Z',
    'no-es-fecha',
  ])('rechaza tipos, calendario imposible o zona ausente: %j', (input) => {
    expect(readObservedInstant(input)).toBeUndefined();
  });

  it('conserva una fracción larga y acepta el año extendido del adaptador sin tope propio 0000–9999', () => {
    const fraction = '0'.repeat(10000) + '1';
    const value = readObservedInstant(`+010000-01-01T00:00:00.${fraction}Z`)!;
    expect(value.fraction === fraction).toBe(true);
    expect(observedInstantUtc(value) === value.original).toBe(true);
  });
});
