import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack();
const source = readFileSync('tests/support/check-queue.mjs', 'utf8');
before(
  () => {
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
    // Estas pruebas ejercen reclamación/adaptadores manuales; ningún consumidor
    // concurrente debe reclamar sus jobs antes de la comprobación explícita.
    stack.compose('stop', 'api');
  },
  { timeout: 180000 },
);
after(() => stack.close(), { timeout: 180000 });

for (const [scenario, description] of Object.entries({
  policy: 'pg-boss tiene esquema propio y política de cola explícita',
  runtime: 'runtime publica, reclama y confirma sin permisos DDL ni propietario',
  transaction: 'fromDrizzle confirma o revierte conjuntamente recibo, posición y primer job',
  admission: 'admisión conserva originales y recibo pendiente con partición coherente',
  idempotency: 'reutilización estructural y carrera de la misma recepción no duplican trabajos',
  admission_rollback: 'fallo después de publicar revierte la admisión real y su job',
  preparation: 'preparación repetida conserva trabajos y rechaza política incompatible',
  quota: 'dos admitidores compiten por la última plaza y un recibo existente sigue consultable',
})) {
  test(description, () => {
    assert.equal(
      stack.apiTool(`process.env.NEXO_QUEUE_CASE=${JSON.stringify(scenario)};\n${source}`),
      'queue-case-ok',
    );
  });
}
