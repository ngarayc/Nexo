import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { produceSystemEvents } from '../support/system-producer.mjs';

test('alertas globales respetan 80/81 y tardíos y enlazan su evento sin otro snapshot o SSE', async ({
  page,
}) => {
  const reads = { stream: 0, snapshot: 0 };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/stream') reads.stream++;
    if (path === '/api/snapshot') reads.snapshot++;
  });
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill('demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
  const initial = Number(await page.getByTestId('alert-total').textContent());
  const prefix = 'alerts-' + randomUUID();
  const a = prefix + '-A',
    b = prefix + '-B';
  const observation = (suffix, vehicleId, second, speedKph, ignitionOn = true) => ({
    eventId: prefix + suffix,
    vehicleId,
    observedAt: `2026-01-01T05:00:0${second}Z`,
    latitude: 4,
    longitude: -74,
    speedKph,
    ignitionOn,
  });
  const records = [
    observation('-80', a, 2, 80),
    observation('-81', a, 3, 81),
    observation('-late', a, 1, 95),
    observation('-off', b, 2, 81, false),
  ];
  expect(produceSystemEvents(records)).toEqual({ accepted: 4, duplicates: 0, rejected: 0 });
  await expect(page.getByTestId('alert-total')).toHaveText(String(initial + 3));
  await page.getByLabel('Buscar vehículo', { exact: true }).fill(a);
  await expect(page.locator('nexo-fleet-table tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Alertas', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Alertas por exceso de velocidad', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('alerts-view-total')).toHaveText(String(initial + 3));
  const rows = page.locator('nexo-alerts-table tbody tr');
  await expect(rows).toHaveCount(initial + 3);
  expect(
    await rows.evaluateAll(
      (items, prefix) =>
        items
          .map((item) => item.getAttribute('data-event-id'))
          .filter((id) => id.startsWith(prefix)),
      prefix,
    ),
  ).toEqual([prefix + '-81', prefix + '-off', prefix + '-late']);
  expect(
    await rows.evaluateAll(
      (items, id) => items.some((item) => item.getAttribute('data-event-id') === id),
      prefix + '-80',
    ),
  ).toBe(false);
  expect(produceSystemEvents(records)).toEqual({ accepted: 0, duplicates: 4, rejected: 0 });
  expect(
    produceSystemEvents([
      { ...records[1], speedKph: 82 },
      { ...records[0], eventId: prefix + '-invalid', latitude: 91 },
    ]),
  ).toEqual({ accepted: 0, duplicates: 0, rejected: 2 });
  await expect(page.getByTestId('alerts-view-total')).toHaveText(String(initial + 3));
  await page.getByRole('button', { name: 'Ver evento ' + prefix + '-late', exact: true }).click();
  const selected = page.locator('nexo-vehicle-history tbody tr[aria-current="true"]');
  await expect(selected).toHaveAttribute('data-event-id', prefix + '-late');
  await expect(selected).toContainText('95');
  await expect(selected).toBeFocused();
  await expect(page.locator('nexo-fleet-table tbody tr')).toHaveAttribute(
    'data-event-id',
    prefix + '-81',
  );
  const search = page.getByLabel('Buscar vehículo', { exact: true });
  await search.focus();
  expect(produceSystemEvents([observation('-older', a, 0, 0)])).toEqual({
    accepted: 1,
    duplicates: 0,
    rejected: 0,
  });
  await expect(page.locator('nexo-vehicle-history tbody tr')).toHaveCount(4);
  await expect(search).toBeFocused();
  await page.getByRole('link', { name: 'Alertas', exact: true }).click();
  await page.getByRole('button', { name: 'Ver evento ' + prefix + '-off', exact: true }).click();
  await expect(selected).toHaveAttribute('data-event-id', prefix + '-off');
  await expect(selected).toContainText('No');
  expect(reads).toEqual({ stream: 1, snapshot: 1 });
});
