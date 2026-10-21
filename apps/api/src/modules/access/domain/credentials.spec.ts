import { describe, expect, it } from 'vitest';
import { readCredentials } from './credentials.js';

describe('formato de credenciales sin coerción ni truncado', () => {
  it('conserva exactamente los valores, espacios y mayúsculas', () => {
    expect(readCredentials({ username: ' Demo ', password: ' x ' })).toEqual({
      username: ' Demo ',
      password: ' x ',
    });
  });
  it('cuenta bytes UTF-8, incluidos los límites exactos', () => {
    expect(readCredentials({ username: 'é'.repeat(32), password: 'é'.repeat(128) })).toBeDefined();
    expect(readCredentials({ username: 'é'.repeat(33), password: 'x' })).toBeUndefined();
    expect(readCredentials({ username: 'demo', password: 'é'.repeat(129) })).toBeUndefined();
  });
  it('rechaza estructura, tipos y cadenas vacías', () => {
    for (const value of [
      null,
      [],
      'demo',
      {},
      { username: 1, password: 'x' },
      { username: 'demo', password: 4 },
      { username: '', password: 'demo' },
      { username: 'demo', password: '' },
    ])
      expect(readCredentials(value)).toBeUndefined();
  });
});
