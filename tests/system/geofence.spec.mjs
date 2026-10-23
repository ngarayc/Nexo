import { test, expect } from '../support/browser-test.mjs';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
test('zona fija clasifica por SSE, conserva cruces observados y ambos resultados originales', async ({
  browser,
}) => {
  const page = await browser.newPage();
  try {
    await signIn(page);
    await expect(page.locator('.connection-status')).toHaveText('En vivo');
    const summary = page.getByTestId('geofence-summary');
    await expect(summary).toContainText('0 dentro · 0 fuera');
    expect(produceSystemEvents(events.slice(0, 1))).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect(summary).toContainText('0 dentro · 1 fuera');
    await page.getByRole('button', { name: 'Ver geocerca', exact: true }).click();
    await expect(page.locator('nexo-fleet-map path.nexo-geofence')).toBeVisible();
    expect(produceSystemEvents(events.slice(1))).toEqual({
      accepted: 19,
      duplicates: 2,
      rejected: 2,
    });
    await expect(summary).toContainText('2 dentro · 6 fuera');
    await page.getByRole('button', { name: 'Ver geocerca', exact: true }).click();
    const zone = await page.locator('nexo-fleet-map path.nexo-geofence').boundingBox();
    const inside = await page
      .locator('nexo-fleet-map .nexo-fleet-marker')
      .and(page.getByRole('button', { name: /^Vehículo VEH-001 ·/ }))
      .boundingBox();
    const outside = await page
      .locator('nexo-fleet-map .nexo-fleet-marker')
      .and(page.getByRole('button', { name: /^Vehículo VEH-003 ·/ }))
      .boundingBox();
    expect(inside.x + inside.width / 2).toBeGreaterThan(zone.x);
    expect(inside.x + inside.width / 2).toBeLessThan(zone.x + zone.width);
    expect(inside.y + inside.height / 2).toBeGreaterThan(zone.y);
    expect(inside.y + inside.height / 2).toBeLessThan(zone.y + zone.height);
    expect(outside.x + outside.width / 2).toBeGreaterThan(zone.x + zone.width);
    await expect(page.locator('nexo-fleet-table [data-geofence="inside"]')).toHaveCount(2);
    for (const id of ['VEH-001', 'VEH-002'])
      await expect(
        page.locator(`nexo-fleet-table [data-vehicle-id="${id}"] [data-geofence]`),
      ).toHaveText('Dentro');
    await page.getByRole('button', { name: 'Ver historial de VEH-001', exact: true }).click();
    await expect(page.locator('nexo-vehicle-trajectory .geofence-changes li')).toHaveCount(1);
    await expect(page.locator('nexo-vehicle-trajectory .geofence-changes')).toContainText(
      'Entrada observada',
    );
    await page.getByRole('button', { name: 'Ver observación E-001-02', exact: true }).click();
    await expect(page.locator('nexo-vehicle-trajectory .observation')).toContainText('E-001-02');
    await expect(page.locator('nexo-vehicle-trajectory .observation')).toContainText('Dentro');
    await page.getByRole('button', { name: 'Ver geocerca en trayectoria', exact: true }).click();
    await expect(page.locator('nexo-vehicle-trajectory path.nexo-geofence')).toBeVisible();
    expect(produceSystemEvents(events)).toEqual({ accepted: 0, duplicates: 22, rejected: 2 });
    await expect(summary).toContainText('2 dentro · 6 fuera');
    await expect(page.locator('nexo-vehicle-trajectory .geofence-changes li')).toHaveCount(1);
    expect(domainCounts()).toEqual({
      events: 20,
      vehicles: 8,
      alerts: 4,
      messages: 43,
      pending: 0,
    });
  } finally {
    await page.close();
  }
});
