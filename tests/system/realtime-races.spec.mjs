import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { signIn, deferred } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';

test('commits durante snapshot/historial y respuesta cancelada de A no se pierden o cruzan a B', async ({
  page,
}) => {
  test.setTimeout(60000);
  await observeRealtime(page);
  const prefix = 'race-' + randomUUID(),
    a = prefix + '-A',
    b = prefix + '-B';
  const event = (id, vehicleId, second, speedKph = 1) => ({
    eventId: prefix + id,
    vehicleId,
    observedAt: `2026-01-01T05:00:0${second}Z`,
    latitude: 4,
    longitude: -74,
    speedKph,
    ignitionOn: true,
  });
  const captured = deferred(),
    release = deferred();
  let snapshots = 0;
  await page.route('**/api/snapshot', async (route) => {
    snapshots++;
    const response = await route.fetch();
    captured.resolve(await response.json());
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await signIn(page);
    const old = await captured.promise;
    expect(old.vehicles.total).toBe(0);
    expect(produceSystemEvents([event('-a', a, 2)])).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect
      .poll(async () =>
        Object.values((await received(page)).messages).some(
          (message) => message.eventId === prefix + '-a',
        ),
      )
      .toBe(true);
    await expect(page.getByTestId('vehicle-total')).toHaveCount(0);
    release.resolve();
    await expect(page.locator('.connection-status')).toHaveText('En vivo');
    await expect(page.getByTestId('vehicle-total')).toHaveText('1');
    expect(snapshots).toBe(1);
  } finally {
    release.resolve();
    await page.unroute('**/api/snapshot');
  }

  expect(produceSystemEvents([event('-b', b, 2)])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await expect(page.getByTestId('vehicle-total')).toHaveText('2');
  const historyPath = '/api/vehicles/' + encodeURIComponent(a) + '/events';
  const capturedHistory = deferred(),
    releaseHistory = deferred();
  const matchHistory = (url) => url.pathname === historyPath;
  await page.route(matchHistory, async (route) => {
    const response = await route.fetch();
    capturedHistory.resolve(await response.json());
    await releaseHistory.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Ver historial de ' + a, exact: true }).click();
    expect((await capturedHistory.promise).items.map((item) => item.eventId)).toEqual([
      prefix + '-a',
    ]);
    expect(produceSystemEvents([event('-late', a, 1, 95)])).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect
      .poll(async () =>
        Object.values((await received(page)).messages).some(
          (message) => message.eventId === prefix + '-late',
        ),
      )
      .toBe(true);
    releaseHistory.resolve();
    await expect
      .poll(() =>
        page
          .locator('nexo-vehicle-history tbody tr')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
      )
      .toEqual([prefix + '-late', prefix + '-a']);
  } finally {
    releaseHistory.resolve();
    await page.unroute(matchHistory);
  }

  await page.getByRole('button', { name: 'Cerrar historial', exact: true }).click();
  const capturedA = deferred(),
    releaseA = deferred(),
    completedA = deferred();
  let oldRequest;
  await page.route(matchHistory, async (route) => {
    oldRequest = route.request();
    const response = await route.fetch();
    capturedA.resolve();
    await releaseA.promise;
    try {
      await route.fulfill({ response });
    } catch {
      if (!oldRequest.failure()) throw new Error('Respuesta A no descartada de forma comprobable.');
    } finally {
      completedA.resolve();
    }
  });
  try {
    await page.getByRole('button', { name: 'Ver historial de ' + a, exact: true }).click();
    await capturedA.promise;
    await page.getByRole('button', { name: 'Ver historial de ' + b, exact: true }).click();
    await expect.poll(() => Boolean(oldRequest.failure())).toBe(true);
    await expect
      .poll(() =>
        page
          .locator('nexo-vehicle-history tbody tr')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
      )
      .toEqual([prefix + '-b']);
    releaseA.resolve();
    await completedA.promise;
    await expect
      .poll(() =>
        page
          .locator('nexo-vehicle-history tbody tr')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
      )
      .toEqual([prefix + '-b']);
    const state = await received(page);
    expect(state.active).toBe(1);
    expect(state.opened).toBe(1);
    expect(state.invalid).toBe(false);
  } finally {
    releaseA.resolve();
    await page.unroute(matchHistory);
  }
});
