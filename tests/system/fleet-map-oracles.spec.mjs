import { test, expect } from '../support/browser-test.mjs';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';
import { domainCounts } from '../support/system-operator.mjs';

const events = readFileSync('fixtures/events.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const markers = (page) => page.locator('nexo-fleet-map .nexo-fleet-marker');
const marker = (page, id) =>
  markers(page).and(page.getByRole('button', { name: new RegExp('^Vehículo ' + id + ' ·') }));

test('mapa, tabla y filtros comparten ambos oráculos en dos clientes sin solicitudes cartográficas externas', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const tiles = [[], []];
  try {
    for (const [index, page] of pages.entries()) {
      page.on('request', (request) => {
        if (new URL(request.url()).origin === 'https://tile.openstreetmap.org')
          tiles[index].push(request);
      });
      await observeRealtime(page);
      await signIn(page);
      const licenses = await page.request.get('/3rdpartylicenses.txt');
      expect(licenses.status()).toBe(200);
      expect(await licenses.text()).toContain('Copyright (c) 2010-2023, Volodymyr Agafonkin');
      expect(await licenses.text()).toContain('BSD 2-Clause License');
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
      await expect(
        page.getByText('No hay posiciones de vehículos visibles en el mapa.', { exact: true }),
      ).toBeVisible();
      await expect(markers(page)).toHaveCount(0);
    }
    expect(domainCounts()).toEqual({ events: 0, vehicles: 0, alerts: 0, messages: 0, pending: 0 });
    expect(produceSystemEvents(events)).toEqual({ accepted: 20, duplicates: 2, rejected: 2 });
    for (const [index, page] of pages.entries()) {
      await expect(markers(page)).toHaveCount(8);
      await expect(page.getByRole('button', { name: 'Todos (8)', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(
        page.getByRole('button', { name: 'En movimiento (7)', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Detenidos (1)', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apagados (0)', exact: true })).toBeVisible();
      await expect(marker(page, 'VEH-001')).toHaveAttribute(
        'aria-label',
        /35 km\/h · 18\/10\/2026 05:05:00 \(Bogotá\)/u,
      );
      await page.getByRole('button', { name: 'Ver flota visible', exact: true }).click();
      await expect.poll(() => tiles[index].length).toBeGreaterThan(0);
      const a = await marker(page, 'VEH-001').boundingBox();
      const b = await marker(page, 'VEH-002').boundingBox();
      // Más longitud significa este (derecha); más latitud significa norte (arriba).
      expect(b.x).toBeGreaterThan(a.x);
      expect(b.y).toBeLessThan(a.y);
      const latest = events.find((event) => event.eventId === 'E-001-02');
      const nearGuatemala = tiles[index].some((request) => {
        const [z, x, y] = new URL(request.url()).pathname.slice(1, -4).split('/').map(Number);
        const scale = 2 ** z;
        const centerX = ((latest.longitude + 180) / 360) * scale;
        const latitude = (latest.latitude * Math.PI) / 180;
        const centerY = ((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2) * scale;
        return z >= 10 && Math.abs(x - centerX) < 4 && Math.abs(y - centerY) < 4;
      });
      expect(nearGuatemala).toBe(true);
      await expect(
        page.getByRole('link', { name: '© OpenStreetMap contributors', exact: true }),
      ).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
      const headers = await tiles[index][0].allHeaders();
      expect(headers.referer).toBe(new URL(page.url()).origin + '/');
      expect(headers.cookie).toBeUndefined();
      expect(headers['x-api-key']).toBeUndefined();
      expect(headers['x-csrf-token']).toBeUndefined();
      expect(headers['user-agent']).toContain('Mozilla/');
      expect(new URL(tiles[index][0].url()).search).toBe('');
    }
    const [first, second] = pages;
    await first.getByRole('button', { name: 'Detenidos (1)', exact: true }).focus();
    await first.keyboard.press('Enter');
    await expect(markers(first)).toHaveCount(1);
    await expect(marker(first, 'VEH-007')).toBeVisible();
    await expect(first.locator('nexo-fleet-table tbody tr')).toHaveCount(1);
    await first.getByLabel('Buscar vehículo', { exact: true }).fill('VEH-001');
    await expect(markers(first)).toHaveCount(0);
    await expect(
      first.getByText('No hay vehículos que coincidan con los filtros.', { exact: true }),
    ).toBeVisible();
    await expect(markers(second)).toHaveCount(8);
    await first.getByRole('button', { name: 'Todos (8)', exact: true }).click();
    await expect(markers(first)).toHaveCount(1);
    await first.getByRole('button', { name: 'Ver flota visible', exact: true }).click();
    await marker(first, 'VEH-001').focus();
    await first.keyboard.press('Enter');
    await expect(first.locator('#vehicle-history')).toBeFocused();
    await expect(first.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(3);
    await first.getByRole('button', { name: 'Detenidos (1)', exact: true }).click();
    await expect(
      first.getByText('El vehículo seleccionado está oculto por los filtros de la flota.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(first.locator('#vehicle-history nexo-vehicle-history tbody tr')).toHaveCount(3);
    await first.getByRole('button', { name: 'Limpiar filtros de flota', exact: true }).click();
    await expect(first.getByLabel('Buscar vehículo', { exact: true })).toBeFocused();
    await expect(markers(first)).toHaveCount(8);
    await expect(marker(first, 'VEH-001')).toHaveClass(/is-selected/u);
    expect(produceSystemEvents(events)).toEqual({ accepted: 0, duplicates: 22, rejected: 2 });
    for (const page of pages) {
      await expect(markers(page)).toHaveCount(8);
      await expect(page.getByTestId('alert-total')).toHaveText('4');
      const stream = await received(page);
      expect(stream.opened).toBe(1);
      expect(stream.active).toBe(1);
      expect(stream.invalid).toBe(false);
    }
    await expect
      .poll(domainCounts)
      .toEqual({ events: 20, vehicles: 8, alerts: 4, messages: 43, pending: 0 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
