import { describe, expect, it } from 'vitest';
import { readIngestionLimits } from './config.js';
import { readBatch, AdmissionError } from '../../domain/batch.js';

describe('perfil de ingesta explícito y compatible con esquema/proxy', () => {
  it('conserva el perfil predeterminado que usan demo y CI', () => {
    expect(readIngestionLimits({})).toEqual({ events: 1000, bodyBytes: 2097152 });
  });
  it('permite reducir límites sin alterar el perfil por defecto ni el fixture', () => {
    const limits = readIngestionLimits({
      INGEST_MAX_EVENTS_PER_BATCH: '1',
      INGEST_MAX_BODY_BYTES: '64',
    });
    expect(readBatch('{"events":[null]}', limits).items.length).toBe(1);
    expect(() => readBatch('{"events":[null,null]}', limits)).toThrow(
      new AdmissionError('BATCH_TOO_LARGE'),
    );
    expect(() => readBatch('{"events":[null]}' + ' '.repeat(64), limits)).toThrow(
      new AdmissionError('BODY_TOO_LARGE'),
    );
    expect(Object.isFrozen(limits)).toBe(true);
  });
  it.each([
    { INGEST_MAX_EVENTS_PER_BATCH: '0' },
    { INGEST_MAX_EVENTS_PER_BATCH: '1001' },
    { INGEST_MAX_EVENTS_PER_BATCH: '1e3' },
    { INGEST_MAX_BODY_BYTES: '2097153' },
    { INGEST_MAX_BODY_BYTES: '-1' },
    { INGEST_MAX_BODY_BYTES: '' },
  ])('rechaza configuración inválida o superior al esquema/proxy, sin ignorarla', (env) => {
    expect(() => readIngestionLimits(env)).toThrow();
  });
});
