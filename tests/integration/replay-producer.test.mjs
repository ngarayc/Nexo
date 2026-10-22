import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-replay-producer.mjs', 'utf8');
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api'), { timeout: 180000 });
after(() => stack.close(), { timeout: 180000 });
for (const [scenario, title] of Object.entries({
  official:
    'adaptador HTTP conserva 48 cuerpos originales y clasifica 20/2/2 → 0/22/2 del receptor',
  lost_response:
    'respuesta HTTP perdida conserva incertidumbre sin reenviar; clave errónea no admite',
})) {
  test(title, { timeout: 180000 }, () => {
    assert.equal(
      stack.apiScript(`process.env.NEXO_PRODUCER_CASE=${JSON.stringify(scenario)};\n${source}`),
      'replay-producer-case-ok',
    );
  });
}
