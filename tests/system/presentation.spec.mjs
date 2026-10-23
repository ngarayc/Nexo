import { test, expect } from '../support/browser-test.mjs';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const tileSources = (map) =>
  map
    .locator('img.leaflet-tile-loaded')
    .evaluateAll((tiles) => tiles.map((tile) => tile.src).sort());

async function singleWorld(page, map) {
  const out = map.getByRole('button', { name: 'Alejar', exact: true });
  for (let step = 0; step < 20 && (await out.getAttribute('aria-disabled')) !== 'true'; step++)
    await out.click();
  await expect(out).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => tileSources(map)).toEqual(['https://tile.openstreetmap.org/0/0/0.png']);
  const tile = await map.locator('img.leaflet-tile-loaded').boundingBox();
  expect(tile.width).toBe(256);
  expect(tile.height).toBe(256);
}

async function wheelLeavesZoom(page, map) {
  await map.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await tileSources(map)).length).toBeGreaterThan(0);
  const before = await tileSources(map);
  const box = await map.boundingBox();
  const scrollBefore = await page.evaluate(() => globalThis.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(scrollBefore);
  await page.waitForTimeout(350); // La rueda de Leaflet aplica su zoom con debounce.
  expect(await tileSources(map)).toEqual(before);
}

test('iconos accesibles, tooltips horizontales, mapas sin rueda ni repetición y panel sobre cartografía', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await signIn(page);
    await expect(page.locator('.connection-status')).toHaveText('En vivo');
    expect(produceSystemEvents(events)).toEqual({ accepted: 20, duplicates: 2, rejected: 2 });
    await expect(page.locator('nexo-fleet-map .nexo-fleet-marker')).toHaveCount(8);
    const history = page.getByRole('button', { name: 'Ver historial de VEH-001', exact: true });
    await history.focus();
    await expect(page.locator('.nexo-action-tooltip')).toHaveText('Ver historial de VEH-001');
    await page.keyboard.press('Escape');
    await expect(page.locator('.nexo-action-tooltip')).toHaveCount(0);
    await expect(history).toBeFocused();
    expect(await history.locator('nexo-icon svg').getAttribute('aria-hidden')).toBe('true');
    await page.getByLabel('Buscar vehículo', { exact: true }).fill('VEH-001');
    await page.getByRole('button', { name: 'Ver flota visible', exact: true }).click();
    const fleet = page.getByRole('region', { name: 'Mapa de últimas posiciones', exact: true });
    await wheelLeavesZoom(page, fleet);
    await page.getByRole('button', { name: 'Ver flota visible', exact: true }).click();
    const marker = fleet.locator('.nexo-fleet-marker');
    await marker.hover();
    const tooltip = fleet.locator('.nexo-fleet-tooltip');
    await expect(tooltip).toContainText('Vehículo VEH-001');
    const dimensions = await tooltip.boundingBox();
    expect(dimensions.width).toBeGreaterThan(200);
    expect(dimensions.height).toBeLessThan(150);
    await singleWorld(page, fleet);
    await page.getByRole('button', { name: 'Ver flota visible', exact: true }).click();
    await marker.click();
    await expect(page.locator('#vehicle-history')).toBeFocused();
    const trajectory = page.getByRole('region', { name: 'Mapa de trayectoria', exact: true });
    await wheelLeavesZoom(page, trajectory);
    await singleWorld(page, trajectory);
    // La prueba de capas necesita una superposición real con el panel fijo.
    // Solo hacerlo visible deja el mapa arriba en algunas métricas de fuente.
    await trajectory.evaluate((map) => map.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await page.getByRole('button', { name: /^Reproductor ·/ }).click();
    const panel = page.getByRole('complementary', { name: 'Reproductor de la demo', exact: true });
    await expect(panel).toBeVisible();
    const a = await panel.boundingBox(),
      b = await trajectory.boundingBox();
    const x = (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2;
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
    expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)).toBeGreaterThan(0);
    expect(Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('nexo-replay-panel'),
        { x, y },
      ),
    ).toBe(true);
    await page.getByRole('button', { name: /^Reproductor ·/ }).click();
    for (const width of [768, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth),
        )
        .toBe(true);
      await page.getByRole('link', { name: 'Alertas', exact: true }).click();
      await expect(page.locator('nexo-alerts-table tbody tr')).toHaveCount(4);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth),
        )
        .toBe(true);
      await page.getByRole('link', { name: 'Flota', exact: true }).click();
      await page.getByRole('button', { name: /^Reproductor ·/ }).click();
      const controls = await page
        .getByRole('group', { name: 'Controles de reproducción', exact: true })
        .boundingBox();
      expect(controls.y).toBeGreaterThan(64);
      expect(controls.y + controls.height).toBeLessThan(900);
      await expect(
        page.getByRole('button', { name: 'Iniciar reproducción', exact: true }),
      ).toBeInViewport();
      await page.getByRole('button', { name: /^Reproductor ·/ }).click();
    }
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
