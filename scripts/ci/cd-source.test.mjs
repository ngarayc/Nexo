import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('operador real valida fuentes y recupera activación fallida sin vaciar datos', () => {
  const result = spawnSync(
    'python3',
    ['-B', '-m', 'unittest', 'discover', '-s', 'tests/cd', '-v'],
    {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.error && !result.signal);
  assert.match(result.stderr, /Ran 8 tests/u);
  assert.match(result.stderr, /\bOK\b/u);
});
