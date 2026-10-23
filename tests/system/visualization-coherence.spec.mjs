import { test, expect } from '../support/browser-test.mjs';
import { randomUUID } from 'node:crypto';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';
import { streamCut } from '../support/stream-cut.mjs';

const chart = (page) => page.locator('nexo-vehicle-speed-chart');
const trajectory = (page) => page.locator('nexo-vehicle-trajectory');
const fleetMarkers = (page) => page.locator('nexo-fleet-map .nexo-fleet-marker');
const event = (eventId, vehicleId, second, changes = {}) => ({
  eventId,
  vehicleId,
  observedAt: '2026-01-01T05:00:' + second + 'Z',
  latitude: 14.6,
  longitude: -90.5,
  speedKph: 0,
  ignitionOn: true,
  ...changes,
});

test('dos clientes conservan filtros y selección de todas las vistas al recuperar SSE y ante cartografía fallida', async ({
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
    for (const page of [first, second]) {
      await observeRealtime(page);
      await signIn(page);
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
    }
    const prefix = 'coherence-' + randomUUID();
    const va = prefix + '-A',
      vb = prefix + '-B';
    const a0 = event(prefix + '-a0', va, '00');
    const a1 = event(prefix + '-a1', va, '01', {
      latitude: 14.601,
      longitude: -90.499,
      speedKph: 81,
    });
    const b0 = event(prefix + '-b0', vb, '00', { latitude: 14.61, ignitionOn: false });
    expect(produceSystemEvents([a0, a1, b0])).toEqual({ accepted: 3, duplicates: 0, rejected: 0 });
    for (const page of [first, second])
      await expect(page.getByTestId('vehicle-total')).toHaveText('2');
    await first.getByLabel('Buscar vehículo', { exact: true }).fill(va);
    await first.getByRole('button', { name: 'En movimiento (1)', exact: true }).click();
    await second.getByLabel('Buscar vehículo', { exact: true }).fill(vb);
    await second.getByRole('button', { name: 'Apagados (1)', exact: true }).click();
    for (const [page, vehicle, selected] of [
      [first, va, a0.eventId],
      [second, vb, b0.eventId],
    ]) {
      await expect(page.locator('nexo-fleet-table tbody tr')).toHaveCount(1);
      await expect(fleetMarkers(page)).toHaveCount(1);
      await page.getByRole('button', { name: 'Ver historial de ' + vehicle, exact: true }).click();
      await page
        .getByRole('button', { name: 'Seleccionar observación ' + selected, exact: true })
        .click();
      await expect(chart(page).locator('.selected-sample')).toContainText(selected);
    }
    await first.getByLabel('Buscar vehículo', { exact: true }).focus();
    await a.setOffline(true);
    cut.disconnect();
    await expect(first.locator('.connection-status')).toContainText('Reconectando');
    await expect.poll(async () => (await received(first)).active).toBe(0);
    await expect(chart(first)).toContainText('2 muestras recibidas');
    const a2 = event(prefix + '-a2', va, '02', { latitude: 14.602, longitude: -90.498 });
    const late = event(prefix + '-late', va, '00.5', { speedKph: 95 });
    const b1 = event(prefix + '-b1', vb, '01', { latitude: 14.611, speedKph: 30 });
    expect(produceSystemEvents([a2, late, b1])).toEqual({
      accepted: 3,
      duplicates: 0,
      rejected: 0,
    });
    await expect(second.getByTestId('alert-total')).toHaveText('2');
    await expect(fleetMarkers(second)).toHaveCount(0);
    await expect(chart(second)).toContainText('2 muestras recibidas');
    await expect(chart(second).locator('.selected-sample')).toContainText(b0.eventId);
    await expect(
      second.getByText('El vehículo seleccionado está oculto por los filtros de la flota.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
    cut.restore();
    await a.setOffline(false);
    await expect(first.locator('.connection-status')).toHaveText('En vivo', { timeout: 20000 });
    await expect(chart(first)).toContainText('4 muestras recibidas');
    await expect(trajectory(first).locator('.nexo-trajectory-marker')).toHaveCount(4);
    await expect(fleetMarkers(first)).toHaveCount(0);
    await expect(first.getByLabel('Buscar vehículo', { exact: true })).toHaveValue(va);
    await expect(
      first.getByRole('button', { name: 'En movimiento (1)', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(chart(first).locator('.selected-sample')).toContainText(a0.eventId);
    await expect(first.getByLabel('Buscar vehículo', { exact: true })).toBeFocused();
    expect(
      await first
        .locator('nexo-vehicle-history tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
    ).toEqual([a0.eventId, late.eventId, a1.eventId, a2.eventId]);
    await first.getByRole('button', { name: 'Limpiar filtros de flota', exact: true }).click();
    await expect(fleetMarkers(first)).toHaveCount(2);
    await expect(fleetMarkers(second)).toHaveCount(0);
    await first.route('https://tile.openstreetmap.org/**', (route) => route.abort('failed'));
    for (const name of ['Mapa de últimas posiciones', 'Mapa de trayectoria'])
      await first
        .getByRole('region', { name, exact: true })
        .getByRole('button', { name: 'Alejar', exact: true })
        .click();
    await expect(first.getByRole('button', { name: 'Reintentar mapa', exact: true })).toBeVisible();
    await expect(
      first.getByRole('button', { name: 'Reintentar mapa de trayectoria', exact: true }),
    ).toBeVisible();
    await expect(chart(first)).toContainText('4 muestras recibidas');
    expect((await a.request.get('/api/session')).status()).toBe(200);
    await first.unroute('https://tile.openstreetmap.org/**');
    for (const name of ['Reintentar mapa', 'Reintentar mapa de trayectoria'])
      await first.getByRole('button', { name, exact: true }).click();
    await expect(first.getByRole('button', { name: 'Reintentar mapa', exact: true })).toHaveCount(
      0,
    );
    await expect(
      first.getByRole('button', { name: 'Reintentar mapa de trayectoria', exact: true }),
    ).toHaveCount(0);
    for (const page of [first, second]) {
      const live = await received(page);
      expect(live.active).toBe(1);
      expect(live.invalid).toBe(false);
    }
    expect((await received(second)).opened).toBe(1);
    await expect
      .poll(domainCounts)
      .toEqual({ events: 6, vehicles: 2, alerts: 2, messages: 13, pending: 0 });
    await first.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(chart(first)).toHaveCount(0);
    await expect(trajectory(first)).toHaveCount(0);
    expect((await a.request.get('/api/session')).status()).toBe(403);
    expect((await b.request.get('/api/session')).status()).toBe(200);
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
  } finally {
    await a.close();
    await b.close();
    await cut.close();
  }
});
