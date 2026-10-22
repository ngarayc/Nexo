import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { produceSystemEvents } from '../support/system-producer.mjs';

test('Angular confirma snapshot y aplica SSE real; logout y nuevo login recuperan una sola conexión', async ({
  page,
}) => {
  const streams = [];
  const errors = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/stream') streams.push(request);
  });
  page.on('pageerror', (error) => errors.push(error.name));
  const login = async () => {
    await page.goto('/login');
    await page.getByLabel('Usuario', { exact: true }).fill('demo');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('En vivo');
  };
  await login();
  const initialVehicles = Number(await page.getByTestId('vehicle-total').textContent());
  const initialAlerts = Number(await page.getByTestId('alert-total').textContent());
  const id = 'system-live-' + randomUUID();
  const result = produceSystemEvents([
    {
      eventId: id,
      vehicleId: id,
      observedAt: '2026-01-01T00:00:00.000000000001Z',
      latitude: 4,
      longitude: -74,
      speedKph: 81,
      ignitionOn: true,
    },
  ]);
  expect(result).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(page.getByTestId('vehicle-total')).toHaveText(String(initialVehicles + 1));
  await expect(page.getByTestId('alert-total')).toHaveText(String(initialAlerts + 1));
  expect(streams.length).toBe(1);
  expect(await page.evaluate(() => window.localStorage.length + window.sessionStorage.length)).toBe(
    0,
  );
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await login();
  await expect(page.getByTestId('vehicle-total')).toHaveText(String(initialVehicles + 1));
  await expect(page.getByTestId('alert-total')).toHaveText(String(initialAlerts + 1));
  expect(streams.length).toBe(2);
  expect(errors).toEqual([]);
});
