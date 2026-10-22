import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { blockOutboxMark, healthStatus, domainCounts } from '../support/system-operator.mjs';
import { streamCut } from '../support/stream-cut.mjs';

test('corte individual, fallo global y logout recuperan dos vistas sin perder admisiones o revocar la otra sesión', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  const cut = await streamCut();
  try {
    const first = await a.newPage(),
      second = await b.newPage();
    await first.route('**/api/stream', (route) => route.continue({ url: cut.url }));
    await observeRealtime(first);
    await observeRealtime(second);
    await signIn(first);
    await signIn(second);
    for (const page of [first, second])
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
    const prefix = 'recovery-' + randomUUID();
    const event = (index, speedKph = 1) => ({
      eventId: prefix + index,
      vehicleId: prefix + index,
      observedAt: '2026-01-01T05:00:00Z',
      latitude: 4,
      longitude: -74,
      speedKph,
      ignitionOn: true,
    });
    expect(produceSystemEvents([event(1)])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    for (const page of [first, second])
      await expect(page.getByTestId('vehicle-total')).toHaveText('1');
    expect(cut.diagnostics()).toEqual({ active: 1, statuses: [200] });
    await a.setOffline(true);
    cut.disconnect();
    await expect(first.locator('.connection-status')).toContainText('Reconectando');
    await expect.poll(async () => (await received(first)).active).toBe(0);
    await expect(first.getByTestId('vehicle-total')).toHaveText('1');
    expect(produceSystemEvents([event(2, 81)])).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    await expect(second.getByTestId('vehicle-total')).toHaveText('2');
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
    await expect(first.getByTestId('vehicle-total')).toHaveText('1');
    expect((await received(second)).opened).toBe(1);
    cut.restore();
    await a.setOffline(false);
    await expect(first.locator('.connection-status')).toHaveText('En vivo', { timeout: 20000 });
    await expect(first.getByTestId('vehicle-total')).toHaveText('2');
    expect((await received(first)).active).toBe(1);

    try {
      expect(blockOutboxMark(true)).toEqual({ ok: true });
      expect(produceSystemEvents([event(3, 81)])).toEqual({
        accepted: 1,
        duplicates: 0,
        rejected: 0,
      });
      await expect.poll(healthStatus).toBe(503);
      for (const page of [first, second]) {
        await expect(page.locator('.connection-status')).not.toHaveText('En vivo');
        await expect(
          page.getByText('Los totales estarán disponibles cuando confirmemos la primera carga.'),
        ).toHaveCount(0);
        expect(
          Number(await page.getByTestId('vehicle-total').textContent()),
        ).toBeGreaterThanOrEqual(2);
      }
      expect(produceSystemEvents([event(4, 81)])).toEqual({
        accepted: 1,
        duplicates: 0,
        rejected: 0,
      });
      expect(domainCounts().events).toBe(4);
    } finally {
      expect(blockOutboxMark(false)).toEqual({ ok: true });
    }
    await expect.poll(healthStatus, { timeout: 20000 }).toBe(200);
    for (const page of [first, second]) {
      await expect(page.locator('.connection-status')).toHaveText('En vivo', { timeout: 20000 });
      await expect(page.getByTestId('vehicle-total')).toHaveText('4');
      await expect(page.getByTestId('alert-total')).toHaveText('3');
      expect((await received(page)).active).toBe(1);
    }
    await first.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(first.getByLabel('Contraseña', { exact: true })).toBeVisible();
    await expect(first.getByTestId('vehicle-total')).toHaveCount(0);
    expect((await received(first)).active).toBe(0);
    expect((await a.request.get('/api/session')).status()).toBe(403);
    expect((await b.request.get('/api/session')).status()).toBe(200);
    expect(produceSystemEvents([event(5)])).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    await expect(second.getByTestId('vehicle-total')).toHaveText('5');
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
    await signIn(first);
    await expect(first.locator('.connection-status')).toHaveText('En vivo');
    await expect(first.getByTestId('vehicle-total')).toHaveText('5');
    expect((await received(first)).active).toBe(1);
  } finally {
    await a.close();
    await b.close();
    await cut.close();
  }
});
