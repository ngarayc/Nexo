import { expect, it } from 'vitest';
import { isRecoverable, recoveryWindow } from './recovery-policy.js';

it('reserva solo dos ventanas adicionales, sin ampliar las tres oportunidades', () => {
  expect(recoveryWindow(1)).toEqual({ baseMilliseconds: 2000, maximumJitterMilliseconds: 500 });
  expect(recoveryWindow(2)).toEqual({ baseMilliseconds: 4000, maximumJitterMilliseconds: 1000 });
  for (const generation of [0, 3, 4, -1, 1.5, NaN])
    expect(() => recoveryWindow(generation)).toThrow();
});

it('separa incertidumbre recuperable de situaciones que requieren intervención', () => {
  for (const code of ['PROCESSING_UNCONFIRMED', 'JOB_MISSING', 'JOB_FAILED'] as const)
    expect(isRecoverable(code)).toBe(true);
  for (const code of [
    'QUEUE_CANCELLED',
    'QUEUE_PROTOCOL_VIOLATION',
    'SCHEMA_INCOMPATIBLE',
    'INGESTION_INVARIANT',
  ] as const)
    expect(isRecoverable(code)).toBe(false);
});
