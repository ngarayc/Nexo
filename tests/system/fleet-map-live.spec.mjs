import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';

const position = (eventId, vehicleId, second, options = {}) => ({
  eventId,
  vehicleId,
  observedAt: `2026-01-01T05:00:${second}Z`,
  latitude: 14.6,
  longitude: -90.5,
  speedKph: 10,
  ignitionOn: true,
  ...options,
});
const markers = (page) => page.locator('nexo-fleet-map .nexo-fleet-marker');

test('Leaflet conserva marcador y encuadre por SSE, falla de tiles local, CSP efectiva y texto inerte a 360px', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 800 });
  await observeRealtime(page);
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const response = await page.goto('/');
  const headers = response.headers();
  expect(headers['referrer-policy']).toBe('no-referrer');
  const csp = headers['content-security-policy'];
  expect(csp).toContain("img-src 'self' data: https://tile.openstreetmap.org;");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).toContain("connect-src 'self';");
  await signIn(page);
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
  const prefix = 'Map-' + randomUUID();
  const id = prefix + '-A';
  const first = position(prefix + '-a0', id, '00');
  expect(produceSystemEvents([first])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(markers(page)).toHaveCount(1);
  const map = page.getByRole('region', { name: 'Mapa de últimas posiciones', exact: true });
  const original = await markers(page).elementHandle();
  await markers(page).focus();
  const pane = page.locator('nexo-fleet-map .leaflet-map-pane');
  const encuadre = await pane.evaluate((element) => element.style.transform);
  const before = await markers(page).boundingBox();
  expect(
    produceSystemEvents([
      position(prefix + '-a2', id, '02', { latitude: 14.601, longitude: -90.499, speedKph: 81 }),
    ]),
  ).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(markers(page)).toHaveAttribute(
    'aria-label',
    /81 km\/h · 01\/01\/2026 00:00:02 \(Bogotá\)/u,
  );
  expect(
    await original.evaluate((element) => element.isConnected && document.activeElement === element),
  ).toBe(true);
  expect(await pane.evaluate((element) => element.style.transform)).toBe(encuadre);
  const after = await markers(page).boundingBox();
  expect(after.x).toBeGreaterThan(before.x);
  expect(after.y).toBeLessThan(before.y);
  const transform = await markers(page).evaluate((element) => element.style.transform);
  expect(
    produceSystemEvents([
      position(prefix + '-a1', id, '01', { latitude: -30, longitude: 120, speedKph: 95 }),
    ]),
  ).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(page.getByTestId('alert-total')).toHaveText('2');
  expect(await markers(page).evaluate((element) => element.style.transform)).toBe(transform);
  expect(await pane.evaluate((element) => element.style.transform)).toBe(encuadre);
  await markers(page).press('Enter');
  await expect(page.locator('#vehicle-history')).toBeFocused();
  await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Cerrar historial', exact: true }).click();
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort('failed'));
  await map.getByRole('button', { name: 'Alejar', exact: true }).click();
  await expect(
    page.getByText(
      'No fue posible cargar la cartografía. La tabla y el historial siguen disponibles.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel('Buscar vehículo', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Ver historial de ' + id, exact: true }).click();
  await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(3);
  const callsAtFailure = requests.length;
  expect(produceSystemEvents([position(prefix + '-a3', id, '03', { speedKph: 0 })])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await expect(markers(page)).toHaveAttribute('aria-label', /Detenido · 0 km\/h/u);
  await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(4);
  expect(requests.slice(callsAtFailure).filter((path) => path.endsWith('.png'))).toHaveLength(0);
  await page.unroute('https://tile.openstreetmap.org/**');
  await page.getByRole('button', { name: 'Reintentar mapa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar mapa', exact: true })).toHaveCount(0);
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
  const blocked = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const onViolation = (event) => {
          if (event.blockedURI !== 'https://blocked.invalid/tile.png') return;
          document.removeEventListener('securitypolicyviolation', onViolation);
          resolve(event.effectiveDirective);
        };
        document.addEventListener('securitypolicyviolation', onViolation);
        const image = document.createElement('img');
        image.src = 'https://blocked.invalid/tile.png';
        image.addEventListener('error', () => image.remove());
        document.body.append(image);
      }),
  );
  expect(blocked).toBe('img-src');
  const html = 'M<img src=x onerror="window.__mapInjected=true">';
  expect(produceSystemEvents([position(prefix + '-html', html, '00')])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await page.getByLabel('Buscar vehículo', { exact: true }).fill('__mapInjected');
  await expect(markers(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Ver flota visible', exact: true }).click();
  await markers(page).focus();
  await expect(page.locator('nexo-fleet-map .nexo-fleet-tooltip')).toContainText(html);
  expect(await page.locator('nexo-fleet-map .nexo-fleet-tooltip img').count()).toBe(0);
  expect(await page.evaluate(() => window.__mapInjected === true)).toBe(false);
  await expect(markers(page)).toHaveAttribute(
    'aria-label',
    'Vehículo ' + html + ' · En movimiento · 10 km/h · 01/01/2026 00:00:00 (Bogotá)',
  );
  await markers(page).press('Space');
  await expect(page.locator('#vehicle-history')).toBeFocused();
  await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    produceSystemEvents([
      position(prefix + '-polar', prefix + '-polar', '00', { latitude: 90, longitude: -90.5 }),
    ]),
  ).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await page.getByLabel('Buscar vehículo', { exact: true }).fill(prefix + '-polar');
  await expect(markers(page)).toHaveCount(1);
  await expect(
    page.getByText(/Algunas latitudes superan el alcance visual de la proyección/u),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Ver historial de ' + prefix + '-polar', exact: true })
    .click();
  await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toContainText('90');
  const stream = await received(page);
  expect(stream.opened).toBe(1);
  expect(stream.active).toBe(1);
  expect(stream.invalid).toBe(false);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(page.locator('nexo-fleet-map')).toHaveCount(0);
  await original.dispose();
});
