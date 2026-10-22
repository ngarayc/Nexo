import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { produceSystemEvents } from '../support/system-producer.mjs';

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill('demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('En vivo');
}
const event = (eventId, vehicleId, second, options = {}) => ({
  eventId,
  vehicleId,
  observedAt: `2026-01-01T05:00:0${second}Z`,
  latitude: 4,
  longitude: -74,
  speedKph: 0,
  ignitionOn: true,
  ...options,
});

test('flota e historial muestran búsqueda literal, tardío por SSE, hora24h y foco en pantalla estrecha', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const streams = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/stream') streams.push(request);
  });
  await login(page);
  const initialTotal = Number(await page.getByTestId('vehicle-total').textContent());
  const prefix = 'Fleet-' + randomUUID();
  const a = prefix + '%_A',
    b = prefix + '-B';
  const html = prefix + '<img src=x onerror="window.__nexoInjected=true">';
  expect(
    produceSystemEvents([
      event(prefix + '-a0', a, '0'),
      event(prefix + '-a2', a, '2', { speedKph: 81 }),
      event(prefix + '-a1', a, '1', { speedKph: 95 }),
      event(prefix + '-b', b, '0', { ignitionOn: false }),
      event(prefix + '-html', html, '0'),
    ]),
  ).toEqual({ accepted: 5, duplicates: 0, rejected: 0 });
  await expect(page.getByTestId('vehicle-total')).toHaveText(String(initialTotal + 3));
  const search = page.getByLabel('Buscar vehículo', { exact: true });
  const rows = page.locator('nexo-fleet-table tbody tr');
  await search.fill(prefix.toLowerCase());
  await expect(rows).toHaveCount(3);
  await expect(
    rows.filter({ has: page.getByRole('rowheader', { name: b, exact: true }) }),
  ).toContainText('Apagado');
  expect(await page.locator('nexo-fleet-table img').count()).toBe(0);
  expect(await page.evaluate(() => window.__nexoInjected === true)).toBe(false);
  // El ID sintético con HTML contiene los dos guiones bajos de __nexoInjected.
  // Ambos deben coincidir literalmente: el resultado se contrasta por ID.
  for (const [query, expected] of [
    ['%', [a]],
    ['_', [a, html]],
  ]) {
    await search.fill(query);
    await expect(rows).toHaveCount(expected.length);
    expect(
      await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-vehicle-id'))),
    ).toEqual(expected);
  }
  const totalAlerts = await page.getByTestId('alert-total').textContent();
  await search.fill('no-match-' + prefix);
  await expect(page.getByText('No hay vehículos que coincidan con la búsqueda.')).toBeVisible();
  await expect(page.getByTestId('alert-total')).toHaveText(totalAlerts);
  await page.getByRole('button', { name: 'Limpiar búsqueda', exact: true }).click();
  await expect(rows).toHaveCount(initialTotal + 3);
  await search.fill(a);
  const open = page.getByRole('button', { name: 'Ver historial de ' + a, exact: true });
  await open.click();
  const panel = page.locator('#vehicle-history');
  await expect(panel).toBeFocused();
  const history = panel.locator('nexo-vehicle-history tbody tr');
  await expect(history).toHaveCount(3);
  await expect(history.first()).toContainText('01/01/2026 00:00:00 (Bogotá)');
  expect(produceSystemEvents([event(prefix + '-a15', a, '1.5')])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await expect(history).toHaveCount(4);
  expect(
    await history.evaluateAll((items) => items.map((item) => item.getAttribute('data-event-id'))),
  ).toEqual([prefix + '-a0', prefix + '-a1', prefix + '-a15', prefix + '-a2']);
  await expect(rows.first()).toHaveAttribute('data-event-id', prefix + '-a2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await panel.getByRole('button', { name: 'Cerrar historial', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(streams.length).toBe(1);
});

test('IDs largos, NUL y sustitutos conservan identidad por POST JSON real con CSRF y sin API key', async ({
  page,
}) => {
  await login(page);
  const prefix = 'json-' + randomUUID();
  const kinds = ['long', 'surrogate', 'nul'];
  const ids = [
    prefix + '-long-' + 'x'.repeat(70000),
    prefix + '-surrogate-\ud800',
    prefix + '-nul-\u0000',
    '.',
    '..',
  ];
  expect(
    produceSystemEvents(ids.map((id, index) => event(prefix + '-e' + index, id, '0'))),
  ).toEqual({ accepted: 5, duplicates: 0, rejected: 0 });
  const search = page.getByLabel('Buscar vehículo', { exact: true });
  for (let index = 0; index < ids.length; index++) {
    await search.fill(index < 3 ? prefix + '-' + kinds[index] + '-' : ids[index]);
    const allRows = page.locator('nexo-fleet-table tbody tr');
    const rows =
      index < 3
        ? allRows
        : allRows.filter({ has: page.getByRole('rowheader', { name: ids[index], exact: true }) });
    await expect(rows).toHaveCount(1);
    const requested = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/queries/vehicle-events',
    );
    await rows.getByRole('button', { name: /^Ver historial de / }).click();
    const request = await requested;
    expect(request.method()).toBe('POST');
    expect(request.postDataJSON().vehicleId).toBe(ids[index]);
    expect(Boolean(request.headers()['x-csrf-token'])).toBe(true);
    expect(Boolean(request.headers()['x-api-key'])).toBe(false);
    await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(1);
    await expect(page.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveAttribute(
      'data-event-id',
      prefix + '-e' + index,
    );
    if (index === 0) {
      await rows.getByText('Ver completo').click();
      expect(await rows.locator('code.full').textContent()).toBe(ids[index]);
      await rows.locator('code.full').focus();
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(() => rows.locator('code.full').evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
    } else if (index < 3) await expect(rows).toContainText(index === 1 ? '\\ud800' : '\\u0000');
  }
});
