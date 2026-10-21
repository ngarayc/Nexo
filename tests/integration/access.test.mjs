import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { testStack } from '../support/stack.mjs';

const stack = testStack();
before(() => stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api'), { timeout: 180000 });
after(() => stack.close(), { timeout: 180000 });

test('hash Argon2 real, credenciales uniformes, dos sesiones, CSRF, logout y vencimiento absoluto', () => {
  const source = readFileSync('tests/support/check-access.mjs', 'utf8');
  assert.equal(stack.apiScript(source) === 'access-runtime-ok', true);
});

test('indisponibilidad de PostgreSQL produce 503 sin cookie de acceso ni detalles técnicos', async () => {
  stack.compose('stop', 'db');
  try {
    const result = JSON.parse(
      stack.apiScript(`
      const r=await fetch('http://127.0.0.1:3000/api/session', { method:'POST',headers:{Origin:process.env.PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({username:'demo',password:'demo'}) });
      console.log(JSON.stringify({status:r.status,body:await r.json(),cookie:r.headers.has('set-cookie')}));
    `),
    );
    assert.equal(result.status, 503);
    assert.equal(result.cookie, false);
    assert.deepEqual(result.body, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Servicio temporalmente no disponible.',
    });
  } finally {
    stack.compose('start', 'db');
    await stack.waitHealthy();
  }
});

test('reiniciar API invalida la sesión y conserva identidad y hash persistidos', () => {
  const identity = () =>
    stack.sql("SELECT id::text || ':' || password_hash FROM users WHERE username='demo'");
  const before = identity();
  const cookie = stack.apiScript(`
    const r=await fetch('http://127.0.0.1:3000/api/session',{method:'POST',headers:{Origin:process.env.PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({username:'demo',password:'demo'})});
    if(r.status!==200) throw Error('Acceso no disponible.');
    console.log(r.headers.get('set-cookie').split(';')[0]);
  `);
  stack.compose('restart', '--no-deps', 'api');
  stack.compose('up', '-d', '--no-build', '--wait', 'api');
  const status = stack.apiScript(`
    const r=await fetch('http://127.0.0.1:3000/api/session',{headers:{Cookie:${JSON.stringify(cookie)}}}); console.log(r.status);
  `);
  assert.equal(status, '403');
  assert.equal(
    identity() === before,
    true,
    'El registro debe conservarse sin publicar sus valores.',
  );
});

test('demo deshabilitada deniega login y sesiones sin alterar la cuenta existente', () => {
  const result = stack.apiScript(`
    process.env.DEMO_ENABLED='false';
    const {createApplication}=await import('/app/apps/api/dist/app.factory.js');
    const app=await createApplication();
    try { await app.listen(3001,'127.0.0.1');
      const r=await fetch('http://127.0.0.1:3001/api/session',{method:'POST',headers:{Origin:process.env.PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({username:'demo',password:'demo'})});
      const current=await fetch('http://127.0.0.1:3001/api/session');
      console.log(JSON.stringify({login:r.status,current:current.status,cookie:r.headers.has('set-cookie')}));
    }finally{await app.close();}
  `);
  assert.deepEqual(JSON.parse(result), { login: 403, current: 403, cookie: false });
  assert.equal(stack.sql('SELECT count(*) FROM users'), '1');
});
