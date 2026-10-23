import { test, expect } from '../support/browser-test.mjs';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';
import { chartPoints, chartColor } from '../support/chart-pixels.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const chart = (page) => page.locator('nexo-vehicle-speed-chart');

test('canvas real selecciona el evento original y se sincroniza con historial, trayectoria y alertas en dos clientes', async ({
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
      await page
        .getByRole('button', {
          name: 'Ver historial de VEH-00' + (index === 0 ? '1' : '5'),
          exact: true,
        })
        .click();
      await expect(
        chart(page).getByRole('img', {
          name: 'Gráfico de velocidad observada en km/h',
          exact: true,
        }),
      ).toBeVisible();
      await expect(chart(page)).toContainText('3 muestras recibidas');
      await expect(chart(page)).toContainText('Alerta cuando supera 80 km/h');
      await expect.poll(() => chartPoints(page).then((points) => points.length)).toBe(3);
    }
    const [first, second] = pages;
    const sample = (await chartPoints(first))[0];
    await chart(first).locator('canvas').click({ position: sample });
    await expect(first.locator('nexo-vehicle-history tr[aria-current="true"]')).toHaveAttribute(
      'data-event-id',
      'E-001-00',
    );
    await expect(chart(first).locator('.selected-sample')).toContainText('95 km/h');
    await expect(first.locator('nexo-vehicle-trajectory .is-selected')).toHaveAttribute(
      'aria-label',
      /^Observación E-001-00 ·/u,
    );
    await expect(second.locator('nexo-vehicle-history tr[aria-current="true"]')).toHaveCount(0);
    await first.mouse.move(0, 0);
    await expect.poll(() => chartColor(first, sample)).toEqual([156, 84, 16, 255]);
    await first.getByRole('link', { name: 'Alertas', exact: true }).click();
    await first.getByRole('button', { name: 'Ver evento E-005-02', exact: true }).click();
    await expect(chart(first).locator('.selected-sample')).toContainText('E-005-02');
    await expect(chart(first).locator('.selected-sample')).toContainText('82 km/h');
    const licenses = await first.request.get('/3rdpartylicenses.txt');
    expect(licenses.status()).toBe(200);
    expect(await licenses.text()).toContain('Chart.js Contributors');
    expect(produceSystemEvents(events)).toEqual({ accepted: 0, duplicates: 22, rejected: 2 });
    for (const page of pages) {
      await expect(chart(page)).toContainText('3 muestras recibidas');
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
