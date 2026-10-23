import { test, expect } from '../support/browser-test.mjs';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const trajectory = (page) => page.locator('nexo-vehicle-trajectory');
const point = (page, id) =>
  trajectory(page).getByRole('button', { name: new RegExp('^Observación ' + id + ' ·') });

test('trayectoria e historial comparten selección con alertas y conservan ambos replays en dos clientes', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of pages) {
      await observeRealtime(page);
      await signIn(page);
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
    }
    expect(produceSystemEvents(events)).toEqual({ accepted: 20, duplicates: 2, rejected: 2 });
    for (const [index, page] of pages.entries()) {
      await expect(page.getByTestId('vehicle-total')).toHaveText('8');
      const vehicle = index === 0 ? 'VEH-001' : 'VEH-005';
      await page.getByRole('button', { name: 'Ver historial de ' + vehicle, exact: true }).click();
      await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(3);
      await expect(trajectory(page).locator('.leaflet-overlay-pane path')).toHaveCount(1);
      const rows = page.locator('nexo-vehicle-history tbody tr');
      expect(
        await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-event-id'))),
      ).toEqual(
        index === 0 ? ['E-001-00', 'E-001-01', 'E-001-02'] : ['E-005-01', 'E-005-02', 'E-005-03'],
      );
      await expect(trajectory(page)).toContainText('No representan una ruta calculada por calles');
    }
    const [first, second] = pages;
    await first
      .getByRole('button', { name: 'Seleccionar observación E-001-00', exact: true })
      .focus();
    await first.keyboard.press('Enter');
    await expect(point(first, 'E-001-00')).toHaveClass(/is-selected/u);
    await expect(trajectory(first).locator('.observation')).toContainText('95 km/h');
    await expect(first.locator('nexo-vehicle-history tr[aria-current="true"]')).toBeFocused();
    await expect(second.locator('nexo-vehicle-history tr[aria-current="true"]')).toHaveCount(0);
    await first.getByRole('button', { name: 'Ver trayectoria completa', exact: true }).click();
    await point(first, 'E-001-02').click();
    await expect(first.locator('nexo-vehicle-history tr[aria-current="true"]')).toHaveAttribute(
      'data-event-id',
      'E-001-02',
    );
    await expect(trajectory(first).locator('.observation')).toContainText('35 km/h');
    await first.getByRole('link', { name: 'Alertas', exact: true }).click();
    await first.getByRole('button', { name: 'Ver evento E-005-02', exact: true }).click();
    await expect(first.locator('nexo-vehicle-history tr[aria-current="true"]')).toHaveAttribute(
      'data-event-id',
      'E-005-02',
    );
    await expect(point(first, 'E-005-02')).toHaveClass(/is-selected/u);
    await expect(trajectory(first).locator('.observation')).toContainText('82 km/h');
    expect(produceSystemEvents(events)).toEqual({ accepted: 0, duplicates: 22, rejected: 2 });
    for (const page of pages) {
      await expect(trajectory(page).locator('.nexo-trajectory-marker')).toHaveCount(3);
      await expect(page.getByTestId('alert-total')).toHaveText('4');
      const live = await received(page);
      expect(live.opened).toBe(1);
      expect(live.active).toBe(1);
      expect(live.invalid).toBe(false);
    }
    await expect
      .poll(domainCounts)
      .toEqual({ events: 20, vehicles: 8, alerts: 4, messages: 43, pending: 0 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
