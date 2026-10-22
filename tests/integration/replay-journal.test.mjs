import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-replay-journal.mjs', 'utf8');
before(
  () => {
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
    // Estados controlados del diario, sin un emisor/worker paralelo. Estos casos
    // no se presentan como una reproducción HTTP o conformidad oficial.
    stack.compose('stop', 'api');
  },
  { timeout: 180000 },
);
after(() => stack.close(), { timeout: 180000 });

for (const [scenario, title] of Object.entries({
  constraints: 'diario protege índices, claves, permisos y correlación previa al recibo',
  intention: 'intención durable se recupera por su marcador sin conservar campos ajenos',
  complete: '24resultados y cursor confirman juntos; pausa en última línea completa el recorrido',
  concurrency: 'altas y transiciones concurrentes conservan un motor y una revisión ganadora',
  rollback: 'fallar después de actualizar resultado revierte también el avance del cursor',
  recovery: 'recuperar conserva completados y marca pausados/en curso interrumpidos sin enviar',
  diagnostics: 'diagnóstico solo admite campos permitidos y una incertidumbre no se reclasifica',
  history: 'historial pagina por microsegundo/UUID exactos y rechaza cursores/parámetros inválidos',
  capacity: 'cupo1000 reserva24posiciones por ejecución y conserva lectura/cierre al llenarse',
})) {
  test(title, () => {
    assert.equal(
      stack.apiTool(`process.env.NEXO_REPLAY_CASE=${JSON.stringify(scenario)};\n${source}`),
      'replay-journal-case-ok',
    );
  });
}

test(
  'migración desde0002 conserva cuenta/hash/telemetría/proyección/alerta sin precargar replay',
  { timeout: 180000 },
  () => {
    const upgrade = testStack({ publishWeb: false });
    try {
      upgrade.compose('up', '-d', '--no-build', '--wait', 'db');
      assert.equal(
        upgrade.apiTool(`process.env.NEXO_REPLAY_CASE='upgrade';\n${source}`),
        'replay-journal-case-ok',
      );
    } finally {
      upgrade.close();
    }
  },
);
