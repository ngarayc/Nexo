import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack({ publishWeb: false });
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db'), { timeout: 180000 });
after(() => stack.close(), { timeout: 180000 });

test('la migración sustituye la función conservando datos, CHECK y semántica canónica', () => {
  const original = readFileSync('apps/api/migrations/0001_ingestion_foundation.sql', 'utf8').split(
    '--> statement-breakpoint',
  )[0];
  const migration = readFileSync('apps/api/migrations/0004_identity_materialization.sql', 'utf8');
  stack.sql(original);
  stack.sql(`CREATE TABLE canonical_upgrade (key bytea CHECK(nexo_identity_is_canonical(key)));
    INSERT INTO canonical_upgrade VALUES(decode(repeat('00000078',70000),'hex'));
    CREATE TABLE original_function AS SELECT 'public.nexo_identity_is_canonical(bytea)'::regprocedure::oid AS oid;`);
  assert.equal(
    stack.sql('SELECT pg_column_size(key)<octet_length(key) FROM canonical_upgrade'),
    't',
  );
  assert.equal(
    stack.sql(
      "SET statement_timeout='1500ms'; SELECT nexo_identity_is_canonical(key) FROM canonical_upgrade",
      {
        expectedError: '57014',
      },
    ),
    '57014',
  );
  stack.sql(migration);
  assert.equal(
    stack
      .sql(
        "SET statement_timeout='1500ms'; SELECT bool_and(nexo_identity_is_canonical(key)) FROM canonical_upgrade",
      )
      .endsWith('t'),
    true,
  );
  stack.sql(migration);
  assert.equal(
    stack.sql(`SELECT p.oid=f.oid AND p.provolatile='i' AND p.proisstrict AND p.proparallel='s'
      FROM pg_proc p CROSS JOIN original_function f WHERE p.oid='public.nexo_identity_is_canonical(bytea)'::regprocedure`),
    't',
  );
  assert.equal(
    stack.sql('SELECT count(*)=1 AND bool_and(octet_length(key)=280000) FROM canonical_upgrade'),
    't',
  );
  for (const hex of ['', '000000', '00110000', 'ffffffff', '0000d8000000dc00']) {
    assert.equal(
      stack.sql(`INSERT INTO canonical_upgrade VALUES(decode('${hex}','hex'))`, {
        expectedError: '23514',
      }),
      '23514',
    );
  }
  for (const hex of ['00000000', '0000d800', '0000dc00', '0001f4a1']) {
    assert.equal(stack.sql(`SELECT nexo_identity_is_canonical(decode('${hex}','hex'))`), 't');
  }
  assert.equal(stack.sql('SELECT nexo_identity_is_canonical(NULL) IS NULL'), 't');
});
