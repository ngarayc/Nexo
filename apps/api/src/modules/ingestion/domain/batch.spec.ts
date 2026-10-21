import { describe, expect, it } from 'vitest';
import { AdmissionError, batchLimits, readBatch, readIdempotencyKey } from './batch.js';

describe('sobre de ingesta y evidencia original', () => {
  it.each([
    ['{', 'MALFORMED_JSON'],
    ['{"events":[null,]}', 'MALFORMED_JSON'],
    ['null', 'INVALID_BATCH'],
    ['[]', 'INVALID_BATCH'],
    ['{}', 'INVALID_BATCH'],
    ['{"events":null}', 'INVALID_BATCH'],
    ['{"events":[]}', 'EMPTY_BATCH'],
  ])('rechaza el sobre %s sin confundirlo con una posición inválida', (source, code) => {
    expect(() => readBatch(source)).toThrow(new AdmissionError(code as AdmissionError['code']));
  });

  it('conserva posiciones inválidas, extras y números originales sin repararlos', () => {
    const source =
      ' {"meta":{"__proto__":1e400},"events":[null,"texto",{"speedKph":"80","large":9007199254740993}]} ';
    const batch = readBatch(source);
    expect(batch.document.raw).toBe(source);
    expect(batch.items.map((item) => item.raw)).toEqual([
      'null',
      '"texto"',
      '{"speedKph":"80","large":9007199254740993}',
    ]);
    expect(batch.inputBytes).toBe(
      BigInt(
        Buffer.byteLength(source) +
          batch.items.reduce((sum, item) => sum + Buffer.byteLength(item.raw), 0),
      ),
    );
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.items)).toBe(true);
  });

  it('admite exactamente mil posiciones y rechaza mil una', () => {
    expect(readBatch(JSON.stringify({ events: Array(1000).fill(null) })).items.length).toBe(1000);
    expect(() => readBatch(JSON.stringify({ events: Array(1001).fill(null) }))).toThrow(
      new AdmissionError('BATCH_TOO_LARGE'),
    );
  });

  it('mide bytes UTF-8: límite exacto y un byte adicional', () => {
    const prefix = '{"events":[null],"extra":"é"}';
    const source = prefix + ' '.repeat(batchLimits.bodyBytes - Buffer.byteLength(prefix));
    expect(readBatch(source).document.raw).toBe(source);
    expect(() => readBatch(source + ' ')).toThrow(new AdmissionError('BODY_TOO_LARGE'));
  });
});

describe('identificador opcional de recepción', () => {
  const receiptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  it('conserva la identidad UUID v4 y admite ausencia, sin usar un eventId', () => {
    expect(readIdempotencyKey(undefined)).toBeUndefined();
    expect(readIdempotencyKey(receiptId)).toBe(receiptId);
    expect(readIdempotencyKey(receiptId.toUpperCase())).toBe(receiptId);
  });
  it.each([
    null,
    '',
    123,
    ` ${receiptId}`,
    receiptId + ',otra',
    receiptId.replace('-4aaa-', '-1aaa-'),
    receiptId.replace('-8aaa-', '-7aaa-'),
  ])('rechaza una cabecera inválida sin generar otra identidad: %j', (value) => {
    expect(() => readIdempotencyKey(value)).toThrow(new AdmissionError('INVALID_IDEMPOTENCY_KEY'));
  });
});
