import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const source = readFileSync('tests/support/check-replay-control.mjs', 'utf8');
const check = (stack, scenario) =>
  assert.equal(
    stack.apiScript(`process.env.NEXO_CONTROL_CASE=${JSON.stringify(scenario)};\n${source}`),
    'replay-control-case-ok',
  );
for (const [scenario, title] of Object.entries({
  official: 'motor HTTP controlable conserva par oficial, informes y dos streams compartidos',
  partial: 'reinicio parcial explora sin borrar y finalizar conserva escenario inconcluso',
})) {
  test(title, { timeout: 180000 }, () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
      check(stack, scenario);
    } finally {
      stack.close();
    }
  });
}
test(
  'reiniciar API conserva pausa interrumpida y no reanuda despachos',
  { timeout: 180000 },
  async () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
      check(stack, 'prepare_restart');
      stack.compose('restart', 'api');
      await stack.waitHealthy();
      check(stack, 'after_restart');
    } finally {
      stack.close();
    }
  },
);
