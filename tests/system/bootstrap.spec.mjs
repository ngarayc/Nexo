import { test, expect } from '../support/browser-test.mjs';

test('presenta Angular compilado con estilos bajo CSP y sin errores de ejecución', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.addInitScript(() => {
    window.__nexoCspViolations = 0;
    document.addEventListener('securitypolicyviolation', () => {
      window.__nexoCspViolations += 1;
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nexo', exact: true })).toBeVisible();
  await expect(page.locator('nexo-root')).toContainText(/telemetría/i);
  const styleTags = await page
    .locator('style')
    .evaluateAll((styles) => styles.map((style) => Boolean(style.nonce)));
  expect(styleTags.length).toBeGreaterThan(0);
  expect(styleTags.every(Boolean)).toBe(true);
  expect(await page.evaluate(() => window.__nexoCspViolations)).toBe(0);
  expect(errors.length).toBe(0);
});

test('proxy publica salud real y cabeceras sin revelar configuración', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', database: 'ok', schema: 'ok' });
  expect(health.headers()['cache-control']).toBe('no-store');
  const document = await request.get('/');
  expect(document.headers()['x-content-type-options']).toBe('nosniff');
  expect(document.headers()['x-frame-options']).toBe('DENY');
  expect(document.headers()['content-security-policy']).not.toContain("'unsafe-inline'");
  const body = await document.text();
  expect(/SESSION_SECRET|DB_OWNER_PASSWORD|INGEST_API_KEY/.test(body)).toBe(false);
});

test('cada documento recibe un nonce diferente, coherente con su propia política', async ({
  request,
}) => {
  const readNonce = async () => {
    const response = await request.get('/');
    const body = await response.text();
    const match = /ngcspnonce="([a-f0-9]{32})"/i.exec(body);
    expect(Boolean(match)).toBe(true);
    const nonce = match[1];
    expect(response.headers()['content-security-policy'].includes(`'nonce-${nonce}'`)).toBe(true);
    return nonce;
  };
  expect((await readNonce()) === (await readNonce())).toBe(false);
});
