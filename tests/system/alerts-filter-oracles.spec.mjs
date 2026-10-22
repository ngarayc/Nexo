import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const expected = JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8'));
const rowIds = (page) =>
  page
    .locator('nexo-alerts-table tbody tr')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id')));

async function apiFilter(context, origin, vehicleId) {
  const get = await context.request.get('/api/alerts?vehicleId=' + encodeURIComponent(vehicleId));
  expect(get.status()).toBe(200);
  const direct = await get.json();
  const session = await context.request.get('/api/session');
  expect(session.status()).toBe(200);
  const post = await context.request.post('/api/queries/alerts', {
    headers: { Origin: origin, 'X-CSRF-Token': (await session.json()).csrfToken },
    data: { vehicleId },
  });
  expect(post.status()).toBe(200);
  expect(await post.json()).toEqual(direct);
  return direct;
}

test('CR-01 en dos clientes conserva ambos oráculos y coincide con GET/POST sin consultas por selección', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    const calls = [];
    for (const page of [first, second]) {
      page.on('request', (request) => {
        if (['/api/alerts', '/api/queries/alerts'].includes(new URL(request.url()).pathname))
          calls.push(request.method());
      });
      await observeRealtime(page);
      await signIn(page);
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
    }
    expect(domainCounts()).toEqual({ events: 0, vehicles: 0, alerts: 0, messages: 0, pending: 0 });
    expect(produceSystemEvents(events)).toEqual({ accepted: 20, duplicates: 2, rejected: 2 });
    for (const page of [first, second]) {
      await expect(page.getByTestId('vehicle-total')).toHaveText('8');
      await expect(page.getByTestId('alert-total')).toHaveText('4');
    }
    await first.getByLabel('Buscar vehículo', { exact: true }).fill('VEH-001');
    await second.getByLabel('Buscar vehículo', { exact: true }).fill('VEH-005');
    for (const page of [first, second]) {
      await page.getByRole('link', { name: 'Alertas', exact: true }).click();
      await expect(
        page.getByLabel('Filtrar por vehículo', { exact: true }).locator('option'),
      ).toHaveCount(9);
      await expect(page.getByTestId('alerts-view-total')).toHaveText('4');
      await expect(page.getByTestId('alerts-global-total')).toHaveText('4');
      expect((await rowIds(page)).sort()).toEqual([...expected.overspeed_event_ids].sort());
    }
    const chooseA = first.getByLabel('Filtrar por vehículo', { exact: true });
    const chooseB = second.getByLabel('Filtrar por vehículo', { exact: true });
    await chooseA.selectOption(JSON.stringify('VEH-005'));
    await chooseB.selectOption(JSON.stringify('VEH-004'));
    await expect(first.getByTestId('alerts-view-total')).toHaveText('2');
    await expect(second.getByTestId('alerts-view-total')).toHaveText('0');
    await expect(
      second.getByText('Este vehículo no tiene alertas confirmadas.', { exact: true }),
    ).toBeVisible();
    await expect(first.locator('nexo-alerts-table tbody tr').first()).toContainText(
      '18/10/2026 05:15:00 (Bogotá)',
    );
    expect(await rowIds(first)).toEqual(['E-005-03', 'E-005-02']);
    await chooseA.focus();
    await chooseA.press('Home');
    await expect(chooseA).toHaveValue('all');
    await expect(first.getByTestId('alerts-view-total')).toHaveText('4');
    await chooseA.press('ArrowDown');
    await expect(chooseA).toHaveValue(JSON.stringify('VEH-001'));
    await expect(first.getByTestId('alerts-view-total')).toHaveText('1');
    expect(await rowIds(first)).toEqual(['E-001-00']);
    await expect(chooseA).toBeFocused();
    const origin = new URL(first.url()).origin;
    for (const [context, page, id] of [
      [a, first, 'VEH-001'],
      [b, second, 'VEH-004'],
    ]) {
      const api = await apiFilter(context, origin, id);
      expect(api.items.map((item) => item.eventId)).toEqual(await rowIds(page));
      expect(api.total).toBe(Number(await page.getByTestId('alerts-view-total').textContent()));
      expect(api.overallTotal).toBe(4);
    }
    await chooseA.selectOption(JSON.stringify('VEH-005'));
    const matching = await apiFilter(a, origin, 'VEH-005');
    expect(matching.items.map((item) => item.eventId)).toEqual(await rowIds(first));
    await first.getByRole('button', { name: 'Ver evento E-005-02', exact: true }).click();
    await expect(
      first.locator('nexo-vehicle-history tbody tr[aria-current="true"]'),
    ).toHaveAttribute('data-event-id', 'E-005-02');
    await first.getByRole('link', { name: 'Alertas', exact: true }).click();
    await expect(chooseA).toHaveValue(JSON.stringify('VEH-005'));
    expect(produceSystemEvents(events)).toEqual({ accepted: 0, duplicates: 22, rejected: 2 });
    await expect
      .poll(domainCounts)
      .toEqual({ events: 20, vehicles: 8, alerts: 4, messages: 43, pending: 0 });
    for (const page of [first, second]) {
      await expect(page.getByTestId('alert-total')).toHaveText('4');
      await expect(page.getByTestId('alerts-global-total')).toHaveText('4');
      await expect.poll(async () => Object.keys((await received(page)).messages).length).toBe(43);
      const observed = await received(page);
      expect([observed.opened, observed.active, observed.invalid]).toEqual([1, 1, false]);
    }
    await expect(chooseA).toHaveValue(JSON.stringify('VEH-005'));
    await expect(chooseB).toHaveValue(JSON.stringify('VEH-004'));
    expect(calls).toEqual([]);
    await first.setViewportSize({ width: 360, height: 740 });
    await expect(chooseA).toBeVisible();
    expect(
      await first.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await a.close();
    await b.close();
  }
});
