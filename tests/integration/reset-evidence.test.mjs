import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyArchive } from '../../scripts/demo/reset-evidence.mjs';

test('archivo truncado, alterado o con conteos incompletos impide acreditar evidencia', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-reset-evidence-')),
    name = `snapshot-${randomUUID()}.jsonl`,
    path = join(directory, name);
  const snapshot = {
    kind: 'snapshot',
    data: {
      counts: Object.fromEntries(
        [
          'telemetry_events',
          'vehicle_latest',
          'alerts',
          'outbox_messages',
          'ingestion_batches',
          'ingestion_items',
          'replay_runs',
          'replay_attempts',
        ].map((name) => [name, '0']),
      ),
      accountReady: true,
      migrationHash: 'a'.repeat(64),
    },
  };
  const complete = { kind: 'complete', data: { complete: true } };
  const write = (rows) =>
    writeFileSync(path, rows.map((row) => JSON.stringify(row) + '\n').join(''), { mode: 0o600 });
  try {
    write([snapshot, complete]);
    const expected = verifyArchive(directory, { name });
    assert.equal(verifyArchive(directory, expected).sha256, expected.sha256);
    write([snapshot]);
    assert.throws(() => verifyArchive(directory, { name }));
    write([
      {
        ...snapshot,
        data: { ...snapshot.data, counts: { ...snapshot.data.counts, replay_runs: '1' } },
      },
      complete,
    ]);
    assert.throws(() => verifyArchive(directory, { name }));
    write([{ ...snapshot, data: { ...snapshot.data, accountReady: false } }, complete]);
    assert.throws(() => verifyArchive(directory, expected));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
