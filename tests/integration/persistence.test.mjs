import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack();
const source = readFileSync('tests/support/check-persistence.mjs', 'utf8');
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api'), { timeout: 180000 });
after(() => stack.close(), { timeout: 180000 });

for (const [scenario, description] of Object.entries({
  catalog: 'catálogo conserva siete tablas, exclusiones hash, triggers y fracción C',
  unicode: 'driver conserva mayúsculas, Unicode, nulo y sustitutos sin normalizar',
  canonical: 'SQL rechaza identidades binarias no canónicas',
  long_identity: 'IDs largos conservados y conflicto sin actualización mediante exclusión',
  collision: 'dos IDs con colisión real del índice permanecen distintos',
  concurrency: 'dos conexiones compiten por el ID y relectura posterior ve al ganador',
  projection: 'proyección exige mismo vehículo y eventos aceptados son inmutables',
  time_order: 'orden SQL coincide con precisión exacta, negativos y desempate Unicode',
  numeric_checks: 'restricciones rechazan NaN, infinitos y rangos inválidos',
  original_input: 'JSON original conserva escapes, enteros grandes e inválidos sin evento',
  receipt_policy: 'evidencia y presupuesto no se alteran; una posición programada por lote',
  receipt_consistency: 'estados incoherentes y outcome nulo no eluden CHECK',
  technical_failure: 'fallo y bloqueo técnicos no se convierten en rechazo de dominio',
  outbox: 'efecto único e inmutable con publicación técnica actualizable',
  privileges: 'runtime escribe sin modificar eventos, identidades o payloads',
  upgrade: 'actualizar una base E0 y repetir conserva la cuenta y hash exactos',
})) {
  test(description, () => {
    const script = `process.env.NEXO_PERSISTENCE_SCENARIO=${JSON.stringify(scenario)};\n${source}`;
    assert.equal(stack.apiScript(script), 'persistence-case-ok');
  });
}

test('recrear API y PostgreSQL conserva datos exactos de las seis tablas nuevas', () => {
  assert.equal(
    stack.apiScript(`process.env.NEXO_PERSISTENCE_SCENARIO='restart_seed';\n${source}`),
    'persistence-case-ok',
  );
  const keys = {
    telemetry_events: 'event_pk',
    vehicle_latest: 'vehicle_pk',
    alerts: 'event_pk',
    outbox_messages: 'message_id',
    ingestion_batches: 'ingestion_id',
    ingestion_items: 'ingestion_id,item_index',
  };
  const snapshot = () =>
    Object.entries(keys).map(([table, order]) =>
      stack.sql(`SELECT coalesce(json_agg(t ORDER BY ${order})::text,'[]') FROM ${table} t`),
    );
  const before = snapshot();
  assert.equal(
    before.every((value) => value !== '[]'),
    true,
  );
  stack.compose('up', '-d', '--no-build', '--force-recreate', '--wait', 'db', 'api');
  const after = snapshot();
  assert.equal(
    before.every((value, index) => value === after[index]),
    true,
    'Comparar datos en memoria sin publicar su contenido.',
  );
  assert.equal(stack.health().status, 200);
});
