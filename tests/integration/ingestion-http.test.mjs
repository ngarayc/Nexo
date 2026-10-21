import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
const source = readFileSync('tests/support/check-ingestion-http.mjs', 'utf8');
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web'), {
  timeout: 180000,
});
after(() => stack.close(), { timeout: 180000 });
for (const [scenario, description] of Object.entries({
  boundaries: 'API y proxy autorizan antes de JSON y rechazan formato/exceso sin admisión',
  durable: 'HTTP real clasifica lotes límite y conserva idempotencia/recibos por ambas fronteras',
}))
  test(description, () =>
    assert.equal(
      stack.apiScript(
        `process.env.NEXO_INGESTION_HTTP_CASE=${JSON.stringify(scenario)};\n${source}`,
      ),
      'ingestion-http-case-ok',
    ),
  );

test('reiniciar API conserva las recepciones y su trabajo sin reenvío HTTP', async () => {
  const before = stack.sql(
    'SELECT json_agg(b ORDER BY ingestion_id)::text FROM ingestion_batches b',
  );
  const items = stack.sql(
    'SELECT json_agg(i ORDER BY ingestion_id,item_index)::text FROM ingestion_items i',
  );
  stack.compose('restart', 'api');
  await stack.waitHealthy();
  assert.equal(
    before === stack.sql('SELECT json_agg(b ORDER BY ingestion_id)::text FROM ingestion_batches b'),
    true,
  );
  assert.equal(
    items ===
      stack.sql('SELECT json_agg(i ORDER BY ingestion_id,item_index)::text FROM ingestion_items i'),
    true,
  );
  assert.equal(
    stack.apiScript(`process.env.NEXO_INGESTION_HTTP_CASE='restart';\n${source}`),
    'ingestion-http-case-ok',
  );
});

test('consumidor y HTTP reales cumplen 20/2/2, 0/22/2, latest, alertas y 43 efectos sin reset', () => {
  const fixture = readFileSync('fixtures/events.jsonl', 'utf8');
  const expected = JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8'));
  assert.equal(
    stack.apiScript(
      `globalThis.nexoHttpOracle=${JSON.stringify({ fixture, expected })};\nprocess.env.NEXO_INGESTION_HTTP_CASE='oracles';\n${source}`,
    ),
    'ingestion-http-case-ok',
  );
});
