import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const source = readFileSync('tests/support/check-realtime.mjs', 'utf8');
for (const [scenario, description] of Object.entries({
  official: 'dos streams por proxy reciben los 43 mensajes originales y repetir no crea otros',
  sessions: 'logout y cupos SSE aíslan sesiones y liberan una plaza sin afectar otra conexión',
  quota: 'treinta aperturas SSE comparten cuota; origen y sesión se comprueban antes de consumirla',
  degradation:
    'fallo real de marcado degrada salud/stream sin detener ingesta y recuperación renueva instancia',
  heartbeat:
    'heartbeat cruza el proxy sin compresión y la conexión ociosa sigue recibiendo cambios',
})) {
  test(description, { timeout: 180000 }, () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      const data = {
        fixture: readFileSync('fixtures/events.jsonl', 'utf8'),
        expected: JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8')),
      };
      assert.equal(
        stack.apiScript(
          `globalThis.nexoRealtimeFixture=${JSON.stringify(data)};\nprocess.env.NEXO_REALTIME_CASE=${JSON.stringify(scenario)};\n${source}`,
        ),
        'realtime-case-ok',
      );
    } finally {
      stack.close();
    }
  });
}
