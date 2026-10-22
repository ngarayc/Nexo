import { expect, it } from 'vitest';
import { formatTime } from './format-time';

it('presenta fecha, segundos y hora 00–23 en Bogotá independientemente del offset recibido', () => {
  expect(formatTime('2026-01-01T05:00:00Z')).toBe('01/01/2026 00:00:00 (Bogotá)');
  expect(formatTime('2026-01-01T00:00:00-05:00')).toBe('01/01/2026 00:00:00 (Bogotá)');
  expect(formatTime('2026-01-02T04:59:59.999999999999Z')).toBe('01/01/2026 23:59:59 (Bogotá)');
});

it('conserva el segundo en fracciones largas, cambio de día e instantes negativos', () => {
  expect(formatTime('2026-01-01T05:00:01.99999999999999999991Z')).toBe(
    '01/01/2026 00:00:01 (Bogotá)',
  );
  expect(formatTime('2026-01-02T04:59:59.99999999999999999999Z')).toBe(
    '01/01/2026 23:59:59 (Bogotá)',
  );
  expect(formatTime('1969-12-31T23:59:59.99999999999999999999Z')).toBe(
    '31/12/1969 18:59:59 (Bogotá)',
  );
});

it('presenta ticks numéricos y conserva el rechazo explícito de instantes inválidos', () => {
  expect(formatTime(Date.UTC(2026, 0, 1, 5))).toBe('01/01/2026 00:00:00 (Bogotá)');
  expect(() => formatTime('invalid')).toThrow(RangeError);
});
