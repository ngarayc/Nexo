import { expect, it } from 'vitest';
import { TelemetryInvariantError } from '../../telemetry/public.js';
import { IngestionInvariantError } from '../domain/recovery-policy.js';
import { processingFailure } from './processing-failure.js';

it('distingue invariantes/esquema de fallos transitorios sin publicar detalles', () => {
  for (const error of [
    new TelemetryInvariantError('private'),
    new IngestionInvariantError(),
    { code: '23514' },
    { cause: { code: '23503' } },
  ])
    expect(processingFailure(error)).toBe('INGESTION_INVARIANT');
  expect(processingFailure(new Error('query private', { cause: { code: '42P01' } }))).toBe(
    'SCHEMA_INCOMPATIBLE',
  );
  for (const code of ['40P01', '55P03', '57014', '08006'])
    expect(processingFailure({ code, message: 'private' })).toBe('PROCESSING_UNCONFIRMED');
  expect(processingFailure('SCHEMA_INCOMPATIBLE')).toBe('PROCESSING_UNCONFIRMED');
});

it('un ciclo o cadena arbitraria de causas queda acotado', () => {
  const error: { cause?: unknown } = {};
  error.cause = error;
  expect(processingFailure(error)).toBe('PROCESSING_UNCONFIRMED');
  let nested: unknown = { code: '42P01' };
  for (let i = 0; i < 10; i++) nested = { cause: nested };
  expect(processingFailure(nested)).toBe('PROCESSING_UNCONFIRMED');
});
