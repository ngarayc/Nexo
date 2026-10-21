import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-processing.mjs', 'utf8');
before(
  () => {
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
    stack.compose('stop', 'api');
  },
  { timeout: 180000 },
);
after(() => stack.close(), { timeout: 180000 });
for (const [scenario, description] of Object.entries({
  chain: 'procesador confirma recibos/continuación en orden y una repetición no recrea efectos',
  fences: 'cursor, generación, jobId y notBefore impiden tocar dominio con trabajo obsoleto',
  rollback:
    'fallo tras publicar continuación revierte efectos, resultado, revisión y job siguiente',
}))
  test(description, () =>
    assert.equal(
      stack.apiTool(`process.env.NEXO_PROCESSING_CASE=${JSON.stringify(scenario)};\n${source}`),
      'processing-case-ok',
    ),
  );
