import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { chartPoints } from '../support/chart-pixels.mjs';

const chart = (page) => page.locator('nexo-vehicle-speed-chart');
const event = (id, vehicleId, instant, speedKph) => ({
  eventId: id,
  vehicleId,
  observedAt: '2026-01-01T05:00:' + instant + 'Z',
  latitude: 14.6,
  longitude: -90.5,
  speedKph,
  ignitionOn: true,
});

test('gráfico conserva muestras coincidentes,80/81 y selección por ID ante tardío sin robar foco; velocidad finita extrema no rompe canvas', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 800 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await observeRealtime(page);
  await signIn(page);
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
  const id = 'Speed-' + randomUUID();
  const p = event(id + '-p', id, '01.99999999999999999991', 80);
  const q = event(id + '-q', id, '01.99999999999999999992', 80);
  const r = event(id + '-r', id, '03', 81);
  expect(produceSystemEvents([p])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await page.getByRole('button', { name: 'Ver historial de ' + id, exact: true }).click();
  await expect(chart(page)).toContainText('1 muestra recibida');
  await expect(page.getByTestId('alert-total')).toHaveText('0');
  await expect.poll(() => chartPoints(page).then((points) => points.length)).toBe(1);
  expect(produceSystemEvents([q, r])).toEqual({ accepted: 2, duplicates: 0, rejected: 0 });
  await expect(chart(page)).toContainText('3 muestras recibidas');
  await expect(page.getByTestId('alert-total')).toHaveText('1');
  await expect.poll(() => chartPoints(page).then((points) => points.length)).toBe(2);
  await page
    .getByRole('button', { name: 'Seleccionar observación ' + q.eventId, exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(chart(page).locator('.selected-sample')).toContainText(q.eventId);
  const selected = await page
    .locator('nexo-vehicle-history tr[aria-current="true"]')
    .elementHandle();
  await page.getByLabel('Buscar vehículo', { exact: true }).focus();
  const late = event(id + '-late', id, '02', 95);
  expect(produceSystemEvents([late])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(chart(page)).toContainText('4 muestras recibidas');
  await expect(page.getByLabel('Buscar vehículo', { exact: true })).toBeFocused();
  expect(
    await selected.evaluate(
      (element) => element.isConnected && element.getAttribute('aria-current') === 'true',
    ),
  ).toBe(true);
  await expect(chart(page).locator('.selected-sample')).toContainText(q.eventId);
  await expect(page.locator('nexo-fleet-table tbody tr')).toHaveAttribute(
    'data-event-id',
    r.eventId,
  );
  expect(produceSystemEvents([late])).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
  await expect(chart(page)).toContainText('4 muestras recibidas');
  expect(produceSystemEvents([event(id + '-maximum', id, '04', Number.MAX_VALUE)])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await expect(chart(page)).toContainText('5 muestras recibidas');
  await expect(page.getByTestId('alert-total')).toHaveText('3');
  await expect(chart(page).locator('canvas')).toBeVisible();
  await expect
    .poll(async () => {
      const points = await chartPoints(page);
      return points.length < 2
        ? 0
        : Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    })
    .toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  const live = await received(page);
  expect(live.opened).toBe(1);
  expect(live.active).toBe(1);
  expect(live.invalid).toBe(false);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(chart(page)).toHaveCount(0);
  await selected.dispose();
});
