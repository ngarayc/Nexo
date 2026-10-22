import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

test(
  'lectores pausados detrás de NGINX liberan cupos mientras otro stream y la ingesta completan 128 eventos',
  { timeout: 180000 },
  () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      const source = readFileSync('tests/support/check-realtime.mjs', 'utf8');
      assert.equal(
        stack.apiScript(`process.env.NEXO_REALTIME_CASE='pressure';\n${source}`),
        'realtime-case-ok',
      );
    } finally {
      stack.close();
    }
  },
);
