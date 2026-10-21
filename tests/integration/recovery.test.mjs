import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-recovery.mjs', 'utf8');
before(
  () => {
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
    stack.compose('stop', 'api');
  },
  { timeout: 180000 },
);
after(() => stack.close(), { timeout: 180000 });
for (const [scenario, description] of Object.entries({
  migration:
    'migración E1→recuperación conserva cuenta/hash, dominio, recibos y jobs; cierres tempranos son cerrados',
  missing:
    'dos recuperadores de un job ausente reservan una oportunidad; scheduler respeta el instante exacto',
  backoff: 'pérdida durante backoff no adelanta notBefore ni reinicia presupuesto',
  exhaustion: 'agotamiento preserva prefijo, distingue bloqueo técnico y permite otro lote',
  terminal:
    'cancelación, job completado sin resultado e invariante detienen sin oportunidades ficticias',
  uncertainty:
    'fallos después de send/COMMIT y antes de ACK conservan verdad durable sin repetir efectos',
  unavailable:
    'consulta ilegible y lote bloqueado no se interpretan como ausencia ni detienen otros lotes',
  fairness: 'páginas reales omiten veinte lotes ocupados y recuperan los siguientes sin inanición',
  capacity:
    'cuotas pendientes, bytes activos y retención se verifican en el límite sin cobrar reutilización',
}))
  test(description, () =>
    assert.equal(
      stack.apiTool(`process.env.NEXO_RECOVERY_CASE=${JSON.stringify(scenario)};\n${source}`),
      'recovery-case-ok',
    ),
  );
