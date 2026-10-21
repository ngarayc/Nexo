import { describe, expect, it } from 'vitest';
import { OriginalJson, InvalidJsonError } from './original-json.js';

describe('JSON estricto, fragmentos originales e igualdad decimal exacta', () => {
  it('extrae posiciones sin cortar comas, escapes o estructuras anidadas', () => {
    const position = '{"eventId":"coma, llave} y \\"comillas\\"", "extra":[1e400,{"x":"\\ud800"}]}';
    const source = ` { "events" : [ null , ${position} , 9007199254740993 ] } `;
    const document = OriginalJson.parse(source);
    expect(document.raw).toBe(source);
    const events = document.property('events')!;
    expect(events.arrayLength).toBe(3);
    const values = events.elements()!;
    expect(values[0]!.raw).toBe('null');
    expect(values[1]!.raw).toBe(position);
    expect(values[2]!.raw).toBe('9007199254740993');
    expect(values[1]!.property('extra')!.elements()![0]!.numberValue).toBe(Infinity);
    expect(values[1]!.property('extra')!.elements()![1]!.property('x')!.stringValue).toBe('\ud800');
  });

  it.each([
    ['1', '1.0', true],
    ['1e0', '10e-1', true],
    ['-0.00e999999', '0', true],
    ['9007199254740992', '9007199254740993', false],
    ['1e400', '10e399', true],
    ['1e400', '1e401', false],
    ['1e1000000', '10e999999', true],
    ['1.000000000000000001', '1.000000000000000002', false],
    ['"1"', '1', false],
    ['true', '1', false],
    ['null', 'false', false],
  ])('compara %s y %s sin Number ni expansión de exponentes', (first, second, equal) => {
    expect(OriginalJson.parse(first).equals(OriginalJson.parse(second))).toBe(equal);
  });

  it('ignora orden de claves, mantiene arrays y distingue ausencia/null', () => {
    const first = OriginalJson.parse('{"b":[1e400,{"n":null}],"a":2}');
    expect(first.equals(OriginalJson.parse('{ "a":2.0,"b":[10e399,{"n":null}]}'))).toBe(true);
    expect(first.equals(OriginalJson.parse('{"a":2,"b":[{"n":null},1e400]}'))).toBe(false);
    expect(OriginalJson.parse('{}').equals(OriginalJson.parse('{"n":null}'))).toBe(false);
  });

  it('conserva extras desde sus fragmentos y trata claves hostiles como datos', () => {
    const extra = '"__proto__":{"nexoPolluted":true},"constructor":1e400,"value":"\\u0000"';
    const document = OriginalJson.parse(`{"eventId":"E1",${extra}}`);
    const retained = document.withoutProperties(new Set(['eventId']));
    expect(retained.raw).toBe(`{${extra}}`);
    expect(retained.property('__proto__')!.property('nexoPolluted')!.booleanValue).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'nexoPolluted')).toBe(false);
    expect(retained.property('value')!.stringValue).toBe('\u0000');
    expect(retained.equals(OriginalJson.parse(`{${extra}}`))).toBe(true);
  });

  it('conserva el documento con claves repetidas y usa el valor final para interpretarlo', () => {
    const source = '{"x":1,"x":2}';
    const document = OriginalJson.parse(source);
    expect(document.raw).toBe(source);
    expect(document.property('x')!.numberValue).toBe(2);
    expect(document.equals(OriginalJson.parse('{"x":2}'))).toBe(true);
  });

  it.each(['', '{', '[1,]', '{"x":1,}', '{/* comentario */"x":1}', '{"x":NaN}', '1 2', '"\\x41"'])(
    'rechaza formato inválido sin repararlo: %s',
    (value) => {
      expect(() => OriginalJson.parse(value)).toThrow(InvalidJsonError);
    },
  );
});
