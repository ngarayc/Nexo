import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-replay-verification.mjs', 'utf8');
before(
  () => {
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
    stack.compose('stop', 'api');
  },
  { timeout: 180000 },
);
after(() => stack.close(), { timeout: 180000 });
for (const [scenario, title] of Object.entries({
  sources: 'imagen contiene fuentes intactas y huella del código ejecutable estable',
  preparation: 'preparación real distingue cola vacía, preparada y activa sin caché',
  official: 'verificador contrasta dos escenarios SQL controlados20/2/2→0/22/2 y conserva informe',
  identities: 'mismos totales con identidad errónea no son conformes',
  foreign_duplicate: 'recibo ajeno duplicado interfiere aunque dominio no cambie',
  foreign_rejected: 'recibo ajeno inválido interfiere aunque dominio no cambie',
  coherence: 'snapshot conserva recibos y jobs coherentes ante admisión confirmada concurrente',
  incomplete: 'inventario público de cola incompleto nunca equivale a vacío',
  unavailable: 'esquema/contexto/lectura fallidos no se presentan como datos vacíos',
})) {
  test(title, () => {
    assert.equal(
      stack.apiTool(`process.env.NEXO_VERIFICATION_CASE=${JSON.stringify(scenario)};\n${source}`),
      'replay-verification-case-ok',
    );
  });
}
