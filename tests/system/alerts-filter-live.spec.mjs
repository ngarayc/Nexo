import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';
import { streamCut } from '../support/stream-cut.mjs';

test('CR-01 mantiene filtros independientes ante SSE, reconexión y logout sin otro flujo por selección', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  const cut = await streamCut();
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    await first.route('**/api/stream', (route) => route.continue({ url: cut.url }));
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
    const prefix = 'filter-' + randomUUID();
    const idA = prefix + '-A\u0000\ud800' + 'x'.repeat(70000),
      idB = prefix + '-<img src=x onerror=alert(1)>',
      idC = prefix + '-C';
    const event = (suffix, vehicleId, minute, speedKph = 81) => ({
      eventId: prefix + suffix,
      vehicleId,
      observedAt: `2026-01-01T18:0${minute}:00Z`,
      latitude: 4,
      longitude: -74,
      speedKph,
      ignitionOn: true,
    });
    expect(
      produceSystemEvents([event('-a1', idA, 0), event('-b1', idB, 0), event('-c1', idC, 0, 80)]),
    ).toEqual({ accepted: 3, duplicates: 0, rejected: 0 });
    for (const page of [first, second]) {
      await expect(page.getByTestId('vehicle-total')).toHaveText('3');
      await expect(page.getByTestId('alert-total')).toHaveText('2');
      await page.getByRole('link', { name: 'Alertas', exact: true }).click();
      await expect(
        page.getByLabel('Filtrar por vehículo', { exact: true }).locator('option'),
      ).toHaveCount(4);
    }
    const chooseA = first.getByLabel('Filtrar por vehículo', { exact: true });
    const chooseB = second.getByLabel('Filtrar por vehículo', { exact: true });
    await chooseA.selectOption(JSON.stringify(idA));
    await chooseB.selectOption(JSON.stringify(idB));
    await first.setViewportSize({ width: 360, height: 740 });
    const identity = first.locator('.filter nexo-identity');
    await identity.locator('summary').click();
    const full = identity.locator('code.full');
    await expect(full).toHaveText(idA.replace('\u0000', '\\u0000').replace('\ud800', '\\ud800'));
    await full.focus();
    await expect(full).toBeFocused();
    expect(
      await first.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true);
    await expect(first.locator('.filter img')).toHaveCount(0);
    await expect(second.locator('.filter img')).toHaveCount(0);
    for (const page of [first, second])
      await expect(page.getByTestId('alerts-view-total')).toHaveText('1');
    await expect(first.locator('nexo-alerts-table')).toContainText('01/01/2026 13:00:00 (Bogotá)');
    await chooseA.focus();
    const nextA = event('-a2', idA, 1, 95);
    expect(produceSystemEvents([nextA])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    expect(produceSystemEvents([nextA])).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    await expect(first.getByTestId('alerts-view-total')).toHaveText('2');
    await expect(second.getByTestId('alerts-view-total')).toHaveText('1');
    for (const page of [first, second])
      await expect(page.getByTestId('alerts-global-total')).toHaveText('3');
    await expect(chooseA).toBeFocused();
    expect(produceSystemEvents([event('-b2', idB, 1)])).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect(first.getByTestId('alerts-view-total')).toHaveText('2');
    await expect(second.getByTestId('alerts-view-total')).toHaveText('2');
    for (const page of [first, second]) {
      await expect(page.getByTestId('alerts-global-total')).toHaveText('4');
      expect([(await received(page)).opened, (await received(page)).active]).toEqual([1, 1]);
    }
    await a.setOffline(true);
    cut.disconnect();
    await expect(first.locator('.connection-status')).toContainText('Reconectando');
    await expect(
      first.getByText('Las alertas mostradas pueden estar desactualizadas.', { exact: true }),
    ).toBeVisible();
    await expect(chooseA).toHaveValue(JSON.stringify(idA));
    expect(produceSystemEvents([event('-a3', idA, 2, 90)])).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect(second.getByTestId('alerts-global-total')).toHaveText('5');
    await expect(second.getByTestId('alerts-view-total')).toHaveText('2');
    await expect(first.getByTestId('alerts-global-total')).toHaveText('4');
    cut.restore();
    await a.setOffline(false);
    await expect(first.locator('.connection-status')).toHaveText('En vivo', { timeout: 20000 });
    await expect(first.getByTestId('alerts-global-total')).toHaveText('5');
    await expect(first.getByTestId('alerts-view-total')).toHaveText('3');
    await expect(chooseA).toHaveValue(JSON.stringify(idA));
    await expect(chooseB).toHaveValue(JSON.stringify(idB));
    expect((await received(first)).active).toBe(1);
    expect((await received(second)).opened).toBe(1);
    await first.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(first.getByLabel('Contraseña', { exact: true })).toBeVisible();
    expect((await b.request.get('/api/session')).status()).toBe(200);
    expect(produceSystemEvents([event('-c2', idC, 3)])).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect(second.getByTestId('alerts-global-total')).toHaveText('6');
    await expect(chooseB).toHaveValue(JSON.stringify(idB));
    await first.getByLabel('Usuario', { exact: true }).fill('demo');
    await first.getByLabel('Contraseña', { exact: true }).fill('demo');
    await first.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(first.locator('.connection-status')).toHaveText('En vivo');
    await first.getByRole('link', { name: 'Alertas', exact: true }).click();
    await expect(chooseA).toHaveValue('all');
    await expect(first.getByTestId('alerts-view-total')).toHaveText('6');
    await expect
      .poll(domainCounts)
      .toEqual({ events: 7, vehicles: 3, alerts: 6, messages: 20, pending: 0 });
    expect((await received(first)).active).toBe(1);
    expect(calls).toEqual([]);
  } finally {
    await a.close();
    await b.close();
    await cut.close();
  }
});
