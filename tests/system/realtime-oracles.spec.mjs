import { test, expect } from '../support/browser-test.mjs';
import { readFileSync } from 'node:fs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const expected = JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8'));
async function login(page) {
  await page.goto('/');
  await page.getByLabel('Usuario', { exact: true }).fill('demo');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.locator('.connection-status')).toHaveText('En vivo');
}
test('dos clientes conservan20/2/2 y0/22/2, las20observaciones y43UUID del fixture original', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    await observeRealtime(first);
    await observeRealtime(second);
    await login(first);
    await login(second);
    const cookieA = (await a.cookies()).find((cookie) => cookie.name === 'nexo.sid');
    const cookieB = (await b.cookies()).find((cookie) => cookie.name === 'nexo.sid');
    expect(Boolean(cookieA && cookieB && cookieA.value !== cookieB.value)).toBe(true);
    expect(domainCounts()).toEqual({ events: 0, vehicles: 0, alerts: 0, messages: 0, pending: 0 });
    expect(produceSystemEvents(events)).toEqual({ accepted: 20, duplicates: 2, rejected: 2 });
    for (const page of [first, second]) {
      await expect(page.getByTestId('vehicle-total')).toHaveText('8');
      await expect(page.getByTestId('alert-total')).toHaveText('4');
      await expect.poll(async () => Object.keys((await received(page)).messages).length).toBe(43);
      const rows = page.locator('nexo-fleet-table tbody tr');
      await expect
        .poll(() =>
          rows.evaluateAll((items) =>
            Object.fromEntries(
              items.map((item) => [
                item.getAttribute('data-vehicle-id'),
                item.getAttribute('data-event-id'),
              ]),
            ),
          ),
        )
        .toEqual(expected.latest_by_vehicle);
      await expect(rows.locator('.MOVING')).toHaveCount(7);
      await expect(rows.locator('.STOPPED')).toHaveCount(1);
    }
    const observed = await received(first),
      other = await received(second);
    expect(observed.invalid || other.invalid).toBe(false);
    expect(observed.frames).toBe(43);
    expect(other.frames).toBe(43);
    expect(Object.keys(observed.messages).sort()).toEqual(Object.keys(other.messages).sort());
    expect(
      Object.values(observed.messages)
        .filter((message) => message.type === 'telemetry.accepted')
        .map((message) => message.eventId)
        .sort(),
    ).toEqual([...expected.accepted_event_ids].sort());
    for (const [vehicleId, history] of Object.entries(expected.history_by_vehicle_ascending)) {
      await first
        .getByRole('button', { name: 'Ver historial de ' + vehicleId, exact: true })
        .click();
      const rows = first.locator('nexo-vehicle-history tbody tr');
      await expect(rows).toHaveCount(history.length);
      await expect
        .poll(() =>
          rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-event-id'))),
        )
        .toEqual(history);
    }
    await first.getByLabel('Buscar vehículo', { exact: true }).fill('VEH-001');
    await second.getByLabel('Buscar vehículo', { exact: true }).fill('VEH-005');
    await expect(first.locator('nexo-fleet-table tbody tr')).toHaveCount(1);
    await expect(second.locator('nexo-fleet-table tbody tr')).toHaveCount(1);
    await second.getByRole('button', { name: 'Ver historial de VEH-005', exact: true }).click();
    await expect
      .poll(() =>
        second
          .locator('nexo-vehicle-history tbody tr')
          .evaluateAll((items) => items.map((item) => item.getAttribute('data-event-id'))),
      )
      .toEqual(expected.history_by_vehicle_ascending['VEH-005']);
    await second.getByRole('link', { name: 'Alertas', exact: true }).click();
    const alerts = second.locator('nexo-alerts-table tbody tr');
    await expect(alerts).toHaveCount(4);
    expect(
      (
        await alerts.evaluateAll((items) => items.map((item) => item.getAttribute('data-event-id')))
      ).sort(),
    ).toEqual([...expected.overspeed_event_ids].sort());
    expect(produceSystemEvents(events)).toEqual({ accepted: 0, duplicates: 22, rejected: 2 });
    await expect
      .poll(domainCounts)
      .toEqual({ events: 20, vehicles: 8, alerts: 4, messages: 43, pending: 0 });
    for (const page of [first, second]) {
      await expect(page.getByTestId('vehicle-total')).toHaveText('8');
      await expect(page.getByTestId('alert-total')).toHaveText('4');
      const final = await received(page);
      expect(Object.keys(final.messages).length).toBe(43);
      expect(final.frames).toBe(43);
      expect(final.active).toBe(1);
      expect(final.opened).toBe(1);
    }
    await expect(first.getByLabel('Buscar vehículo', { exact: true })).toHaveValue('VEH-001');
    await second.getByRole('link', { name: 'Flota', exact: true }).click();
    await expect(second.getByLabel('Buscar vehículo', { exact: true })).toHaveValue('VEH-005');
  } finally {
    await a.close();
    await b.close();
  }
});
