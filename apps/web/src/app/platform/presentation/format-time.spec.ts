import { expect, it } from 'vitest';
import { formatTime } from './format-time';

it('presenta fecha, segundos y hora 00–23 en Bogotá independientemente del offset recibido', () => {
  expect(formatTime('2026-01-01T05:00:00Z')).toBe('01/01/2026 00:00:00 (Bogotá)');
  expect(formatTime('2026-01-01T00:00:00-05:00')).toBe('01/01/2026 00:00:00 (Bogotá)');
  expect(formatTime('2026-01-02T04:59:59.999999999999Z')).toBe('01/01/2026 23:59:59 (Bogotá)');
});
