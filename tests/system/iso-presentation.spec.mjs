import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { signIn } from '../support/browser-session.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';

test.use({ hasTouch: true });

test('ISO con coma, forma básica y offset conserva orden exacto y se presenta sin errores en tabla, historial y mapas', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await signIn(page);
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
  const id = 'ISO-' + randomUUID();
  const events = [
    {
      eventId: id + '-a',
      vehicleId: id,
      observedAt: '2026-01-01T05:00:01,5Z',
      latitude: 14.6,
      longitude: -90.5,
      speedKph: 0,
      ignitionOn: true,
    },
    {
      eventId: id + '-b',
      vehicleId: id,
      observedAt: '20260101T050001,75Z',
      latitude: 14.601,
      longitude: -90.499,
      speedKph: 81,
      ignitionOn: true,
    },
    {
      eventId: id + '-c',
      vehicleId: id,
      observedAt: '2026-01-01T00:00:01,99999999999999999991-05:00',
      latitude: 14.602,
      longitude: -90.498,
      speedKph: 35,
      ignitionOn: true,
    },
  ];
  expect(produceSystemEvents([events[2], events[0], events[1]])).toEqual({
    accepted: 3,
    duplicates: 0,
    rejected: 0,
  });
  const row = page.locator('nexo-fleet-table tbody tr');
  await expect(row).toHaveAttribute('data-event-id', id + '-c');
  await expect(row).toContainText('01/01/2026 00:00:01 (Bogotá)');
  await expect(page.getByTestId('alert-total')).toHaveText('1');
  const marker = page.locator('nexo-fleet-map .nexo-fleet-marker');
  await expect(marker).toHaveAttribute(
    'aria-label',
    /35 km\/h · 01\/01\/2026 00:00:01 \(Bogotá\)/u,
  );
  await page.getByRole('button', { name: 'Ver historial de ' + id, exact: true }).click();
  const rows = page.locator('nexo-vehicle-history tbody tr');
  await expect(rows).toHaveCount(3);
  expect(
    await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-event-id'))),
  ).toEqual(events.map((event) => event.eventId));
  for (const item of await rows.all())
    await expect(item).toContainText('01/01/2026 00:00:01 (Bogotá)');
  await expect(page.locator('nexo-vehicle-trajectory .nexo-trajectory-marker')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Seleccionar observación ' + id + '-b', exact: true })
    .click();
  await expect(page.locator('nexo-vehicle-trajectory .observation')).toContainText('81 km/h');
  const response = await page.request.get('/api/vehicles/' + id + '/events');
  expect(response.status()).toBe(200);
  const history = await response.json();
  expect(history.items.map((event) => event.observedAt)).toEqual([
    '2026-01-01T05:00:01.5Z',
    '2026-01-01T05:00:01.75Z',
    '2026-01-01T05:00:01.99999999999999999991Z',
  ]);
  expect(history.items.map((event) => event.observedAtOriginal)).toEqual(
    events.map((event) => event.observedAt),
  );
  const precision = page.getByRole('region', { name: 'Fecha de la observación seleccionada' });
  const summary = precision.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(precision.locator('details')).toHaveAttribute('open', '');
  await expect(precision.getByTestId('observation-original-time')).toHaveText(events[1].observedAt);
  await expect(precision.getByTestId('observation-utc-time')).toHaveText('2026-01-01T05:00:01.75Z');
  await page
    .getByRole('button', { name: 'Seleccionar observación ' + id + '-c', exact: true })
    .click();
  await expect(precision.getByTestId('observation-original-time')).toHaveText(events[2].observedAt);
  await expect(precision.getByTestId('observation-utc-time')).toHaveText(
    '2026-01-01T05:00:01.99999999999999999991Z',
  );
  const live = {
    ...events[0],
    eventId: id + '-d',
    observedAt: '2026-01-01T06:00:01.8888888888888888888+01:00',
  };
  expect(produceSystemEvents([live])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  await expect(rows).toHaveCount(4);
  await page.setViewportSize({ width: 360, height: 740 });
  await page
    .getByRole('button', { name: 'Seleccionar observación ' + id + '-d', exact: true })
    .tap();
  await expect(precision.getByTestId('observation-original-time')).toHaveText(live.observedAt);
  await expect(precision.getByTestId('observation-utc-time')).toHaveText(
    '2026-01-01T05:00:01.8888888888888888888Z',
  );
  await summary.tap();
  await expect(precision.locator('details')).not.toHaveAttribute('open');
  await summary.tap();
  await expect(precision.locator('details')).toHaveAttribute('open', '');
  await expect(row).toHaveAttribute('data-event-id', id + '-c');
  expect(errors).toEqual([]);
});
