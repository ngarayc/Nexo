import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-classification.mjs', 'utf8');
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api'), {
  timeout: 180000,
});
after(() => stack.close(), { timeout: 180000 });

for (const [scenario, description] of Object.entries({
  oracles:
    'clasificación SQL respeta ambas pasadas, identidades, estados y 43 mensajes del fixture',
  rollback: 'fallo entre escrituras revierte evento, proyección, alerta y mensajes juntos',
  identity: 'payload exacto conserva Unicode, extras grandes, instantes y límites 80/81',
  races: 'concurrencia resuelve duplicado/conflicto sin sobrescritura ni regresión de latest',
})) {
  test(description, () => {
    const prefix = `process.env.NEXO_CLASSIFICATION_CASE=${JSON.stringify(scenario)};\n`;
    const fixtures = `globalThis.nexoClassificationInputs=${JSON.stringify({
      fixture: readFileSync('fixtures/events.jsonl', 'utf8'),
      expected: JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8')),
    })};\n`;
    assert.equal(stack.apiScript(prefix + fixtures + source), 'classification-case-ok');
  });
}
