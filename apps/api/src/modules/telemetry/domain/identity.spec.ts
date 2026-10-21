import { describe, expect, it } from 'vitest';
import {
  encodeIdentity,
  decodeIdentity,
  isCanonicalIdentity,
  compareIdentity,
  IdentityEncodingError,
} from './identity.js';

const hex = (value: Uint8Array) =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const binary = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

describe('identidad reversible y canónica, sin normalizar cadenas', () => {
  it.each([
    ['AZ', '000000410000005a'],
    ['\u0000', '00000000'],
    ['é', '000000e9'],
    ['e\u0301', '0000006500000301'],
    ['\u{1f4a1}', '0001f4a1'],
    ['\ud800', '0000d800'],
    ['\udc00', '0000dc00'],
    ['\ud800\udc00', '00010000'],
    ['\u{10ffff}', '0010ffff'],
  ])('conserva exactamente un caso de caracteres: %j', (input, expected) => {
    const encoded = encodeIdentity(input);
    expect(hex(encoded)).toBe(expected);
    expect(isCanonicalIdentity(encoded)).toBe(true);
    expect(decodeIdentity(encoded) === input).toBe(true);
  });

  it('conserva espacios, mayúsculas y formas Unicode diferentes', () => {
    for (const input of [' ', 'Demo', 'demo', ' demo ', 'é', 'e\u0301', '__proto__'])
      expect(decodeIdentity(encodeIdentity(input)) === input).toBe(true);
    expect(hex(encodeIdentity('é')) === hex(encodeIdentity('e\u0301'))).toBe(false);
  });

  it.each(['', '00', '000000', '00110000', 'ffffffff', '0000d8000000dc00'])(
    'rechaza bytes no canónicos: %s',
    (input) => {
      const bytes = binary(input);
      expect(isCanonicalIdentity(bytes)).toBe(false);
      expect(() => decodeIdentity(bytes)).toThrow(IdentityEncodingError);
    },
  );

  it('rechaza identidad vacía y respeta el desplazamiento de una vista binaria', () => {
    expect(() => encodeIdentity('')).toThrow(IdentityEncodingError);
    const storage = binary('ffffffff000000410000005affffffff');
    expect(decodeIdentity(storage.subarray(4, 12))).toBe('AZ');
  });

  it('ordena por puntos de código, incluidos suplementarios y sustitutos aislados', () => {
    const expected = ['A', 'AA', 'B', '\ud800', '\udc00', '\ue000', '\u{10000}', '\u{10ffff}'];
    expect([...expected].reverse().sort(compareIdentity)).toEqual(expected);
    expect(compareIdentity('é', 'é')).toBe(0);
    expect(compareIdentity('é', 'e\u0301')).toBe(1);
  });

  it('conserva IDs largos poco compresibles y secuencias UTF-16 variadas', () => {
    let seed = 0x16498127;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    let value = '';
    for (let index = 0; index < 100000; index += 1) value += String.fromCharCode(next() & 0xffff);
    const encoded = encodeIdentity(value);
    expect(isCanonicalIdentity(encoded)).toBe(true);
    expect(decodeIdentity(encoded) === value).toBe(true);
    expect(compareIdentity(value, decodeIdentity(encoded))).toBe(0);
  });
});
