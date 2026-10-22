import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-outbox.mjs', 'utf8');
before(
  () => {
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api');
    // Los estados intermedios se verifican mediante el dispatcher real invocado
    // por el test, sin otro proceso que publique concurrentemente esas filas.
    stack.compose('stop', 'api');
  },
  { timeout: 180000 },
);
after(() => stack.close(), { timeout: 180000 });

for (const [scenario, description] of Object.entries({
  confirmed:
    'marcado SQL confirmado con respuesta perdida no repite; reiniciar conserva publicados',
  retry: 'fallo de marcado conserva UUID, backoff durable y progreso de otro lote',
  late: 'rollback no publica y un commit tardío se descubre después de publicar otro más reciente',
  sizes:
    'metadatos preceden a payloads; grupos de cien y trama mayor de 2 MiB aislada conservan bytes exactos',
})) {
  test(description, { timeout: 180000 }, () => {
    assert.equal(
      stack.apiTool(`process.env.NEXO_OUTBOX_CASE=${JSON.stringify(scenario)};\n${source}`),
      'outbox-case-ok',
    );
  });
}
