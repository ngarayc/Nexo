import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { signIn, deferred } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';

const trajectory = (page) => page.locator('nexo-vehicle-trajectory');
const point = (page, id) =>
  trajectory(page).getByRole('button', { name: new RegExp('^Observación ' + id + ' ·') });
const rowIds = (page) =>
  page
    .locator('nexo-vehicle-history tbody tr')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id')));
const event = (eventId, vehicleId, time, changes = {}) => ({
  eventId,
  vehicleId,
  observedAt: '2026-01-01T05:00:' + time + 'Z',
  latitude: 14.6,
  longitude: -90.5,
  speedKph: 80,
  ignitionOn: true,
  ...changes,
});

test('muestras coincidentes y tiempo subnanosegundo conservan geometría, selección y encuadre ante tardío; respuesta vieja no reemplaza otro vehículo', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 800 });
  await observeRealtime(page);
  await signIn(page);
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
  const prefix = 'Trajectory-' + randomUUID();
  const a = prefix + '-A',
    b = prefix + '-B';
  const p = event(prefix + '-p', a, '01.000000000001');
  const q = event(prefix + '-q', a, '01.000000000002');
  const r = event(prefix + '-r', a, '02', { latitude: 14.602, longitude: -90.498, speedKph: 81 });
  const late = event(prefix + '-late', a, '01.0000000000015', {
    latitude: 14.599,
    longitude: -90.501,
    speedKph: 95,
  });
  expect(produceSystemEvents([p])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await page.getByRole('button', { name: 'Ver historial de ' + a, exact: true }).click();
  await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(1);
  await expect(trajectory(page).locator('path.nexo-geofence')).toHaveCount(1);
  await expect(
    trajectory(page).locator('.leaflet-overlay-pane path.nexo-trajectory-line'),
  ).toHaveCount(0);
  expect(produceSystemEvents([q, r])).toEqual({ accepted: 2, duplicates: 0, rejected: 0 });
  await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(3);
  expect(await rowIds(page)).toEqual([p.eventId, q.eventId, r.eventId]);
  await page
    .getByRole('button', { name: 'Seleccionar observación ' + q.eventId, exact: true })
    .click();
  await expect(point(page, q.eventId)).toHaveClass(/is-selected/u);
  const selected = await point(page, q.eventId).elementHandle();
  const pane = trajectory(page).locator('.leaflet-map-pane');
  const camera = await pane.evaluate((element) => element.style.transform);
  const line = trajectory(page).locator('.leaflet-overlay-pane path.nexo-trajectory-line');
  const previousPath = await line.getAttribute('d');
  await page.getByLabel('Buscar vehículo', { exact: true }).focus();
  expect(produceSystemEvents([late])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(4);
  await expect(page.getByLabel('Buscar vehículo', { exact: true })).toBeFocused();
  expect(
    await selected.evaluate(
      (element) => element.isConnected && element.classList.contains('is-selected'),
    ),
  ).toBe(true);
  expect(await pane.evaluate((element) => element.style.transform)).toBe(camera);
  expect(await rowIds(page)).toEqual([p.eventId, late.eventId, q.eventId, r.eventId]);
  await expect(page.locator('nexo-fleet-table tbody tr')).toHaveAttribute(
    'data-event-id',
    r.eventId,
  );
  expect(await line.getAttribute('d')).not.toBe(previousPath);
  const ordered = [];
  for (const id of [p.eventId, late.eventId, q.eventId, r.eventId])
    ordered.push(
      await point(page, id).evaluate((element) => [
        new window.DOMMatrixReadOnly(window.getComputedStyle(element).transform).e,
        new window.DOMMatrixReadOnly(window.getComputedStyle(element).transform).f,
      ]),
    );
  const coordinates = [
    ...(await line.getAttribute('d')).matchAll(/[ML](-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/gu),
  ].map((match) => [Number(match[1]), Number(match[2])]);
  expect(coordinates).toEqual(ordered);
  expect(produceSystemEvents([late])).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
  await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(4);
  expect(produceSystemEvents([event(prefix + '-b', b, '00')])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await page.getByRole('button', { name: 'Ver historial de ' + b, exact: true }).click();
  await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(1);
  const captured = deferred(),
    release = deferred(),
    settled = deferred();
  const path = '/api/vehicles/' + a + '/events';
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      const response = await route.fetch();
      captured.resolve();
      await release.promise;
      try {
        await route.fulfill({ response });
      } catch (error) {
        if (!route.request().failure()) throw error;
      } finally {
        settled.resolve();
      }
    },
  );
  try {
    await page.getByRole('button', { name: 'Ver historial de ' + a, exact: true }).click();
    await captured.promise;
    const cancelled = page.waitForEvent(
      'requestfailed',
      (request) => new URL(request.url()).pathname === path,
    );
    await page.getByRole('button', { name: 'Ver historial de ' + b, exact: true }).click();
    expect((await cancelled).failure()).not.toBeNull();
    await expect(point(page, prefix + '-b')).toBeVisible();
    release.resolve();
    await settled.promise;
    await expect(page.locator('nexo-vehicle-history tbody tr')).toHaveCount(1);
    expect(await rowIds(page)).toEqual([prefix + '-b']);
    await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(1);
    await expect(
      trajectory(page).locator('.leaflet-overlay-pane path.nexo-trajectory-line'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const live = await received(page);
    expect(live.opened).toBe(1);
    expect(live.active).toBe(1);
    expect(live.invalid).toBe(false);
  } finally {
    release.resolve();
    await selected.dispose();
  }
});
