import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const oracle = JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8'));
test('dos paneles controlan el motor real, conservan ambos oráculos y muestran inspector/informes', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const one = await browser.newContext(),
    two = await browser.newContext({ viewport: { width: 360, height: 800 } });
  try {
    const first = await one.newPage(),
      second = await two.newPage();
    for (const page of [first, second]) {
      await observeRealtime(page);
      await signIn(page);
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
      await page.getByRole('button', { name: /^Reproductor ·/ }).click();
      await expect(
        page.getByRole('button', { name: 'Iniciar reproducción', exact: true }),
      ).toBeEnabled();
    }
    await first.getByLabel('Intervalo entre líneas (milisegundos)', { exact: true }).fill('250');
    await first.getByRole('button', { name: 'Iniciar reproducción', exact: true }).click();
    await expect
      .poll(async () => Number(await first.getByTestId('replay-accepted').textContent()))
      .toBeGreaterThan(0);
    await expect(second.getByRole('button', { name: 'Pausar', exact: true })).toBeEnabled();
    await second.getByRole('button', { name: 'Pausar', exact: true }).click();
    for (const page of [first, second])
      await expect(page.getByTestId('replay-state')).toHaveText('Pausado');
    const paused = domainCounts();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(domainCounts()).toEqual(paused);
    await first.getByRole('button', { name: /^Reproductor ·/ }).click();
    await second.getByLabel('Intervalo entre líneas (milisegundos)', { exact: true }).fill('100');
    await second.getByRole('button', { name: 'Reanudar', exact: true }).click();
    await first.getByRole('link', { name: 'Alertas', exact: true }).click();
    await first.getByRole('button', { name: /^Reproductor ·/ }).click();
    for (const page of [first, second]) {
      await expect(page.getByTestId('replay-state')).toHaveText('Recorrido completado', {
        timeout: 60000,
      });
      await expect(page.getByTestId('replay-accepted')).toHaveText('20');
      await expect(page.getByTestId('replay-duplicates')).toHaveText('2');
      await expect(page.getByTestId('replay-rejected')).toHaveText('2');
      await expect(page.getByTestId('vehicle-total')).toHaveText('8');
      await expect(page.getByTestId('alert-total')).toHaveText('4');
    }
    expect(domainCounts()).toEqual({
      events: 20,
      vehicles: 8,
      alerts: 4,
      messages: 43,
      pending: 0,
    });
    expect(
      (
        await first
          .locator('nexo-alerts-table tbody tr')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id')))
      ).sort(),
    ).toEqual([...oracle.overspeed_event_ids].sort());
    expect(
      await second
        .locator('nexo-fleet-table tbody tr')
        .evaluateAll((rows) =>
          Object.fromEntries(
            rows.map((row) => [
              row.getAttribute('data-vehicle-id'),
              row.getAttribute('data-event-id'),
            ]),
          ),
        ),
    ).toEqual(oracle.latest_by_vehicle);
    await expect(
      second.getByRole('button', { name: 'Reiniciar reproducción', exact: true }),
    ).toBeEnabled();
    await second.getByRole('button', { name: 'Reiniciar reproducción', exact: true }).click();
    for (const page of [first, second]) {
      await expect(page.getByText('Segundo recorrido oficial', { exact: true })).toBeVisible();
      await expect(page.getByTestId('replay-state')).toHaveText('Recorrido completado', {
        timeout: 60000,
      });
      await expect(page.getByTestId('replay-accepted')).toHaveText('0');
      await expect(page.getByTestId('replay-duplicates')).toHaveText('22');
      await expect(page.getByTestId('replay-rejected')).toHaveText('2');
      await expect.poll(async () => Object.keys((await received(page)).messages).length).toBe(43);
      const stream = await received(page);
      expect(stream.invalid).toBe(false);
      expect(stream.frames).toBe(43);
      expect(stream.active).toBe(1);
      expect(stream.opened).toBe(1);
    }
    expect(domainCounts()).toEqual({
      events: 20,
      vehicles: 8,
      alerts: 4,
      messages: 43,
      pending: 0,
    });
    await first.getByRole('tab', { name: 'Control', exact: true }).focus();
    await first.keyboard.press('ArrowRight');
    await expect(first.getByRole('tab', { name: 'Envíos', exact: true })).toBeFocused();
    const rows = first.locator('nexo-replay-panel tbody tr');
    await expect(rows).toHaveCount(24);
    await expect(rows.nth(21)).toContainText('Latitud fuera del rango');
    await expect(rows.nth(22)).toContainText('La velocidad debe ser un número');
    await first.getByRole('tab', { name: 'Control', exact: true }).click();
    await expect(
      first.getByRole('button', { name: 'Finalizar verificación', exact: true }),
    ).toBeEnabled();
    await first.getByRole('button', { name: 'Finalizar verificación', exact: true }).click();
    for (const page of [first, second]) {
      await page.getByRole('tab', { name: 'Verificación', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Informe individual conservado: Conforme', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Cierre del escenario: Conforme', exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: 'Cargar historial', exact: true }).click();
      await expect(
        page.getByLabel('Ejecución a inspeccionar', { exact: true }).locator('option'),
      ).toHaveCount(3);
    }
    await first.getByLabel('Ejecución a inspeccionar', { exact: true }).selectOption({ index: 2 });
    await expect(
      first.getByText('Inspeccionando una ejecución conservada.', { exact: false }),
    ).toBeVisible();
    await first.getByRole('tab', { name: 'Envíos', exact: true }).click();
    await expect(
      first.locator('nexo-replay-panel tbody tr').filter({ hasText: 'Aceptado' }),
    ).toHaveCount(20);
    await expect(
      first.locator('nexo-replay-panel tbody tr').filter({ hasText: 'Duplicado' }),
    ).toHaveCount(2);
    await expect(
      first.locator('nexo-replay-panel tbody tr').filter({ hasText: 'Rechazado' }),
    ).toHaveCount(2);
    await second.reload();
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
    await second.getByRole('button', { name: /^Reproductor ·/ }).click();
    await expect(second.getByTestId('replay-accepted')).toHaveText('0');
    await expect(second.getByTestId('replay-duplicates')).toHaveText('22');
    await expect(
      second.getByRole('button', { name: 'Reiniciar reproducción', exact: true }),
    ).toBeDisabled();
    expect(
      await second.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth),
    ).toBe(true);
    await first.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(first.getByLabel('Usuario', { exact: true })).toBeVisible();
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
  } finally {
    await one.close();
    await two.close();
  }
});
