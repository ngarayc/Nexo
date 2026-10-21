import { expect, it } from 'vitest';
import { readWork } from './work.js';

const valid = { ingestionId: 'a5dd6bd2-355d-4241-a7a8-365439212029', index: 0, generation: 1 };
it('conserva solo la identidad durable y los límites de cursor/generación', () => {
  expect(readWork({ ...valid, arbitrary: 'no copiar' })).toEqual(valid);
  expect(readWork({ ...valid, index: 999, generation: 3 })).toEqual({
    ...valid,
    index: 999,
    generation: 3,
  });
});
it('descarta mensajes ajenos o coordenadas fuera del presupuesto sin coerción', () => {
  for (const value of [
    null,
    [],
    'x',
    {},
    { ...valid, ingestionId: 'bad' },
    { ...valid, index: '0' },
    { ...valid, index: -1 },
    { ...valid, index: 1000 },
    { ...valid, index: 0.5 },
    { ...valid, generation: 0 },
    { ...valid, generation: 4 },
    { ...valid, generation: '1' },
  ])
    expect(readWork(value)).toBeUndefined();
});
