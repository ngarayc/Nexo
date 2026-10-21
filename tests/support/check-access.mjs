// Se ejecuta dentro de la imagen API contra PostgreSQL real. No publica cookies ni hashes.
import assert from 'node:assert/strict';
import { createApplication } from '/app/apps/api/dist/app.factory.js';

const app = await createApplication();
const nativeNow = Date.now;
let offset = 0;
try {
  await app.listen(3001, '127.0.0.1');
  Date.now = () => nativeNow() + offset;
  const origin = process.env.PUBLIC_ORIGIN;
  const send = async (method, body, cookie, token) => {
    const headers = { Origin: origin };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (token) headers['X-CSRF-Token'] = token;
    return fetch('http://127.0.0.1:3001/api/session', {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const cookieOf = (response) => response.headers.get('set-cookie')?.split(';')[0];
  const wrong = await send('POST', { username: 'demo', password: 'wrong' });
  const unknown = await send('POST', { username: 'Demo', password: 'demo' });
  assert.equal(wrong.status, 403);
  assert.equal(unknown.status, 403);
  assert.equal(JSON.stringify(await wrong.json()) === JSON.stringify(await unknown.json()), true);
  assert.equal(cookieOf(wrong) === undefined && cookieOf(unknown) === undefined, true);
  const login = await send('POST', { username: 'demo', password: 'demo' });
  assert.equal(login.status, 200);
  const first = cookieOf(login);
  const snapshot = await login.json();
  assert.equal(Boolean(first), true);
  assert.equal(snapshot.user.username, 'demo');
  assert.equal(Object.keys(snapshot).sort().join(','), 'csrfToken,expiresAt,user');
  const secondLogin = await send('POST', { username: 'demo', password: 'demo' });
  assert.equal(secondLogin.status, 200);
  const second = cookieOf(secondLogin);
  const secondSnapshot = await secondLogin.json();
  assert.equal(Boolean(first !== second && snapshot.csrfToken !== secondSnapshot.csrfToken), true);
  assert.equal((await send('DELETE', undefined, first, secondSnapshot.csrfToken)).status, 403);
  assert.equal((await send('DELETE', undefined, first, snapshot.csrfToken)).status, 204);
  assert.equal((await send('GET', undefined, first)).status, 403);
  assert.equal((await send('GET', undefined, second)).status, 200);
  offset = 4 * 60 * 60 * 1000 - 1000;
  const almost = await send('GET', undefined, second);
  assert.equal(almost.status, 200);
  assert.equal((await almost.json()).expiresAt, secondSnapshot.expiresAt);
  offset = 4 * 60 * 60 * 1000 + 1;
  assert.equal((await send('GET', undefined, second)).status, 403);
  console.log('access-runtime-ok');
} finally {
  Date.now = nativeNow;
  await app.close();
}
