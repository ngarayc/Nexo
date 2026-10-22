import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const source = readFileSync('tests/support/check-replay-control-faults.mjs', 'utf8');
for (const [scenario, title] of Object.entries({
  command_unknown:
    'COMMIT y barrera inciertos no admiten respuesta ni HTTP hasta confirmación real',
  command_rollback: 'creación revertida no emite ni conserva una admisión falsa',
  result_applied:
    'resultado confirmado con respuesta COMMIT perdida conserva clasificación y detiene',
  result_rollback:
    'resultado revertido conserva intento incierto sin reclasificar desde el receptor',
  response_lost: 'respuesta HTTP perdida después de procesar detiene el actor sin reenvío',
  finish_applied:
    'cierre de escenario con COMMIT confirmado y respuesta perdida no reescribe informe',
})) {
  test(title, { timeout: 180000 }, () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
      assert.equal(
        stack.apiScript(`process.env.NEXO_CONTROL_FAULT=${JSON.stringify(scenario)};\n${source}`),
        'replay-control-fault-ok',
      );
    } finally {
      stack.close();
    }
  });
}
