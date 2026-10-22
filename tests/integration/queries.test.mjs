import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const source = readFileSync('tests/support/check-queries.mjs', 'utf8');
for (const [scenario, description] of Object.entries({
  official:
    'consultas autenticadas y snapshot conservan ambos oráculos, historial, latest y alertas sin efectos de negocio',
  adversarial:
    'consultas conservan identidad exacta, fracción subnanosegundo, búsqueda literal y límites JSON por API/proxy',
  alerts: 'CR-01 conserva igualdad binaria, orden, límites API/proxy y ausencia de efectos',
  alertsConsistency: 'CR-01 obtiene items y total global con una sola sentencia PostgreSQL real',
  snapshot: 'snapshot REPEATABLE READ no mezcla una ingesta confirmada entre sus dos lecturas',
  capacity:
    'dieciséis cuerpos de consulta ocupan el cupo antes del parser y el aborto lo libera sin escrituras',
  quota:
    'GET y POST de consulta comparten 600 solicitudes y rechazan la siguiente antes del parser',
})) {
  test(description, { timeout: 180000 }, () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      const fixture = readFileSync('fixtures/events.jsonl', 'utf8');
      const expected = JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8'));
      assert.equal(
        stack.apiScript(
          `globalThis.nexoQueryFixture=${JSON.stringify({ fixture, expected })};\nprocess.env.NEXO_QUERY_CASE=${JSON.stringify(scenario)};\n${source}`,
        ),
        'queries-case-ok',
      );
    } finally {
      stack.close();
    }
  });
}
