import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack();
const identity = () =>
  stack.sql("SELECT id::text || ':' || password_hash FROM users WHERE username='demo'");
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api'), { timeout: 180000 });
after(() => stack.close(), { timeout: 180000 });

test('migra desde vacío antes de anunciar salud real', () => {
  assert.equal(stack.sql('SELECT count(*) FROM drizzle.__drizzle_migrations'), '1');
  assert.deepEqual(stack.health(), {
    status: 200,
    body: { status: 'ok', database: 'ok', schema: 'ok' },
    cache: 'no-store',
  });
});

test('prepara una sola cuenta demo con Argon2id', () => {
  assert.equal(
    stack.sql(
      "SELECT count(*)=1 AND bool_and(username='demo' AND split_part(password_hash,'$',2)='argon2id' AND split_part(password_hash,'$',3)='v=19' AND string_to_array(split_part(password_hash,'$',4),',') @> ARRAY['m=19456','t=2','p=1'] AND array_length(string_to_array(split_part(password_hash,'$',4),','),1)=3) FROM users",
    ),
    't',
  );
});

test('repetir migración y seed conserva el registro y hash', () => {
  const before = identity();
  stack.compose(
    'exec',
    '-T',
    'api',
    'node',
    '/app/apps/api/dist/platform/database/migrate-main.js',
  );
  assert.equal(
    identity() === before,
    true,
    'El seed debe conservar identidad y credencial sin publicar sus valores.',
  );
  assert.equal(stack.sql('SELECT count(*) FROM users'), '1');
});

test('restricciones SQL rechazan otra cuenta y un segundo demo', () => {
  assert.equal(
    stack.sql("INSERT INTO users(username,password_hash) VALUES('otra','marcador')", {
      expectedError: '23514',
    }),
    '23514',
  );
  assert.equal(
    stack.sql("INSERT INTO users(username,password_hash) VALUES('demo','marcador')", {
      expectedError: '23505',
    }),
    '23505',
  );
});

test('runtime lee usuarios pero no cambia credenciales ni crea tablas', () => {
  assert.equal(stack.sql('SELECT count(*) FROM users', { user: 'nexo_app' }), '1');
  assert.equal(
    stack.sql("UPDATE users SET password_hash='marcador'", {
      user: 'nexo_app',
      expectedError: '42501',
    }),
    '42501',
  );
  assert.equal(
    stack.sql('CREATE TABLE forbidden_table(id int)', { user: 'nexo_app', expectedError: '42501' }),
    '42501',
  );
  assert.equal(
    stack.sql(
      "SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole) FROM pg_roles WHERE rolname='nexo_app'",
    ),
    't',
  );
});

test('el proceso HTTP no hereda la contraseña de migraciones', () => {
  const result = stack.compose(
    'exec',
    '-T',
    'api',
    'node',
    '--input-type=module',
    '-e',
    "import {readFileSync} from 'node:fs'; console.log(!readFileSync('/proc/1/environ','utf8').split('\\0').some(v=>v.startsWith('DB_OWNER_PASSWORD=')));",
  );
  assert.equal(result, 'true');
});

test('desconexión de PostgreSQL produce 503 sanitizado y recupera al volver', async () => {
  stack.compose('stop', 'db');
  try {
    assert.deepEqual(stack.health().body, { status: 'unavailable' });
    assert.equal(stack.health().status, 503);
  } finally {
    stack.compose('up', '-d', '--wait', 'db');
  }
  await stack.waitHealthy();
});

test('una tabla ausente impide salud aunque PostgreSQL acepte conexiones', () => {
  stack.sql('ALTER TABLE users RENAME TO users_temporarily_unavailable');
  try {
    assert.equal(stack.health().status, 503);
  } finally {
    stack.sql('ALTER TABLE users_temporarily_unavailable RENAME TO users');
  }
  assert.equal(stack.health().status, 200);
});

test('una credencial incompatible impide seed y no se sobrescribe', () => {
  const saved = stack.sql('SELECT password_hash FROM users');
  stack.sql("UPDATE users SET password_hash='incompatible test marker'");
  try {
    assert.equal(stack.seedFails(), true);
    assert.equal(stack.sql("SELECT password_hash='incompatible test marker' FROM users"), 't');
  } finally {
    stack.sql(`UPDATE users SET password_hash='${saved.replaceAll("'", "''")}'`);
  }
});

test('recrear contenedores conserva usuario y hash en el volumen', () => {
  const saved = identity();
  stack.compose('up', '-d', '--no-build', '--force-recreate', '--wait', 'db', 'api');
  assert.equal(
    identity() === saved,
    true,
    'La recreación debe conservar la credencial persistida.',
  );
  assert.equal(stack.health().status, 200);
});

test('un usuario eliminado no se regenera silenciosamente en una base inicializada', () => {
  const saved = stack.sql('SELECT row_to_json(users) FROM users');
  stack.sql('DELETE FROM users');
  try {
    assert.equal(stack.seedFails(), true);
    assert.equal(stack.sql('SELECT count(*) FROM users'), '0');
    assert.equal(stack.health().status, 503);
  } finally {
    stack.sql(
      `DELETE FROM users; INSERT INTO users SELECT * FROM json_populate_record(NULL::users, '${saved.replaceAll("'", "''")}')`,
    );
  }
  assert.equal(stack.health().status, 200);
});

test('configuración obligatoria inválida aborta preparación', () => {
  assert.equal(stack.invalidConfigurationFails(), true);
  assert.equal(stack.health().status, 200);
});
