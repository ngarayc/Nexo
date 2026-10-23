import { test, expect } from '../support/browser-test.mjs';

async function login(page) {
  await page.goto('/');
  await expect(page.getByLabel('Usuario', { exact: true })).toBeVisible();
  await page.getByLabel('Usuario', { exact: true }).fill('demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

test('dos navegadores acceden con SIDs diferentes; logout conserva la otra sesión', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const pageA = await first.newPage();
    const pageB = await second.newPage();
    await login(pageA);
    await login(pageB);
    const a = (await first.cookies()).find((cookie) => cookie.name === 'nexo.sid');
    const b = (await second.cookies()).find((cookie) => cookie.name === 'nexo.sid');
    expect(Boolean(a && b && a.value !== b.value)).toBe(true);
    expect(a.httpOnly && a.sameSite === 'Strict' && !a.secure && a.path === '/').toBe(true);
    expect(await pageA.evaluate(() => document.cookie.includes('nexo.sid'))).toBe(false);
    await pageA.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(pageA.getByLabel('Contraseña', { exact: true })).toBeVisible();
    expect((await first.request.get('/api/session')).status()).toBe(403);
    expect((await second.request.get('/api/session')).status()).toBe(200);
    await pageB.reload();
    await expect(pageB.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    expect(
      (await second.cookies()).find((cookie) => cookie.name === 'nexo.sid').value === b.value,
    ).toBe(true);
  } finally {
    await first.close();
    await second.close();
  }
});

test('credenciales incorrectas muestran un error claro y limpian la contraseña; permite volver a acceder', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Usuario', { exact: true }).fill('demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Usuario o contraseña incorrectos');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  const storageEmpty = await page.evaluate(
    () => window.localStorage.length === 0 && window.sessionStorage.length === 0,
  );
  expect(storageEmpty).toBe(true);
});

test('proxy rechaza host ajeno y el acceso no confía en cabeceras reenviadas', async ({
  request,
}) => {
  expect(
    (await request.get('/api/health', { headers: { Host: 'attacker.invalid' } })).status(),
  ).toBe(421);
  const forged = await request.post('/api/session', {
    headers: {
      Origin: 'http://attacker.invalid',
      Forwarded: 'host=localhost;proto=http',
      'X-Forwarded-Host': 'localhost',
      'X-Forwarded-Proto': 'http',
    },
    data: { username: 'demo', password: 'demo' },
  });
  expect(forged.status()).toBe(403);
  expect((await forged.json()).code).toBe('ORIGIN_NOT_ALLOWED');
  expect(forged.headers()['set-cookie']).toBeUndefined();
  expect(forged.headers()['strict-transport-security']).toBeUndefined();
  expect(forged.headers()['x-powered-by']).toBeUndefined();
});
