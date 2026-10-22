import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn } from '../support/browser-session.mjs';
import { observeRealtime, received } from '../support/observe-realtime.mjs';
import { domainCounts, replayProof, resetSystemDemo } from '../support/system-operator.mjs';
import { produceSystemEvents } from '../support/system-producer.mjs';

const oracle = JSON.parse(readFileSync('fixtures/expected_detailed.json', 'utf8'));
const sample = JSON.parse(readFileSync('fixtures/expected_sample.json', 'utf8'));
test('dos paneles controlan el motor real, conservan ambos oráculos y muestran inspector/informes', async ({
  browser,
}) => {
  test.setTimeout(150000);
  expect(
    produceSystemEvents([
      {
        eventId: 'RESET-BEFORE-OFFICIAL',
        vehicleId: 'RESET-SENTINEL',
        observedAt: '2026-01-01T00:00:00Z',
        latitude: 0,
        longitude: 0,
        speedKph: 0,
        ignitionOn: false,
      },
    ]),
  ).toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
  resetSystemDemo();
  expect(domainCounts()).toEqual({ events: 0, vehicles: 0, alerts: 0, messages: 0, pending: 0 });
  expect(replayProof()).toMatchObject({ receipts: [], attempts: [], runs: [] });
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
    const cookieA = (await one.cookies()).find((cookie) => cookie.name === 'nexo.sid');
    const cookieB = (await two.cookies()).find((cookie) => cookie.name === 'nexo.sid');
    expect(Boolean(cookieA && cookieB && cookieA.value !== cookieB.value)).toBe(true);
    await first.getByLabel('Intervalo entre líneas (milisegundos)', { exact: true }).fill('250');
    await first.getByRole('button', { name: 'Iniciar reproducción', exact: true }).click();
    await expect
      .poll(async () => Number(await first.getByTestId('replay-accepted').textContent()))
      .toBeGreaterThan(0);
    await expect(second.getByRole('button', { name: 'Pausar', exact: true })).toBeEnabled();
    await second.getByRole('button', { name: 'Pausar', exact: true }).click();
    for (const page of [first, second])
      await expect(page.getByTestId('replay-state')).toHaveText('Pausado');
    await expect.poll(() => domainCounts().pending).toBe(0);
    const paused = domainCounts();
    const pausedProof = replayProof();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(domainCounts()).toEqual(paused);
    expect(replayProof().receipts).toEqual(pausedProof.receipts);
    expect(replayProof().attempts).toEqual(pausedProof.attempts);
    for (const page of [first, second])
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
    await first.getByRole('button', { name: /^Reproductor ·/ }).click();
    await second.getByLabel('Intervalo entre líneas (milisegundos)', { exact: true }).fill('100');
    await second.getByRole('button', { name: 'Reanudar', exact: true }).click();
    await first.getByRole('link', { name: 'Alertas', exact: true }).click();
    await first.getByRole('button', { name: /^Reproductor ·/ }).click();
    for (const page of [first, second]) {
      await expect(page.getByTestId('replay-state')).toHaveText('Recorrido completado', {
        timeout: 60000,
      });
      await expect(page.getByTestId('replay-accepted')).toHaveText(String(sample.accepted));
      await expect(page.getByTestId('replay-duplicates')).toHaveText(String(sample.duplicates));
      await expect(page.getByTestId('replay-rejected')).toHaveText(String(sample.rejected));
      await expect(page.getByTestId('vehicle-total')).toHaveText(String(sample.vehicles));
      await expect(page.getByTestId('alert-total')).toHaveText(String(sample.overspeed_alerts));
    }
    await expect.poll(domainCounts).toEqual({
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
    expect(oracle.latest_by_vehicle).toEqual(sample.latest_by_vehicle);
    const fleet = second.locator('nexo-fleet-table tbody tr');
    for (const [vehicle, status] of Object.entries(sample.status_by_vehicle))
      await expect(
        fleet
          .filter({
            has: second.getByRole('button', { name: 'Ver historial de ' + vehicle, exact: true }),
          })
          .locator('.' + status),
      ).toHaveCount(1);
    await second.getByRole('button', { name: /^Reproductor ·/ }).click();
    for (const [vehicle, history] of Object.entries(oracle.history_by_vehicle_ascending)) {
      await second
        .getByRole('button', { name: 'Ver historial de ' + vehicle, exact: true })
        .click();
      await expect
        .poll(() =>
          second
            .locator('nexo-vehicle-history tbody tr')
            .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id'))),
        )
        .toEqual(history);
    }
    await second.getByRole('button', { name: /^Reproductor ·/ }).click();
    await expect.poll(() => replayProof().runs[0]?.verification).toBe('conformant');
    const firstProof = replayProof();
    expect(firstProof.receipts).toHaveLength(oracle.first_run.input);
    expect(firstProof.attempts).toHaveLength(oracle.first_run.input);
    expect(firstProof.runs).toHaveLength(1);
    expect(firstProof.runs[0]).toMatchObject({
      state: 'completed',
      verification: 'conformant',
      stage: 'first',
    });
    expect(firstProof.runs[0].reportFingerprint).toMatch(/^[a-f0-9]{64}$/);
    for (const duplicate of oracle.duplicates_at_input_indexes_zero_based)
      expect(firstProof.attempts[duplicate.index]).toMatchObject({
        line_number: duplicate.index + 1,
        batch_index: 0,
        outcome: 'duplicate',
        state: 'classified',
      });
    for (const rejected of oracle.rejections_at_input_indexes_zero_based)
      expect(firstProof.attempts[rejected.index]).toMatchObject({
        line_number: rejected.index + 1,
        batch_index: 0,
        outcome: 'rejected',
        reason_code: rejected.reason,
        state: 'classified',
      });
    for (const page of [first, second])
      await expect.poll(async () => Object.keys((await received(page)).messages).length).toBe(43);
    const firstStream = await received(first),
      otherStream = await received(second);
    const messageIds = Object.keys(firstStream.messages).sort();
    expect(messageIds).toEqual(Object.keys(otherStream.messages).sort());
    for (const [type, count] of [
      ['telemetry.accepted', 20],
      ['vehicle.updated', 19],
      ['alert.created', 4],
    ])
      expect(
        Object.values(firstStream.messages).filter((message) => message.type === type),
      ).toHaveLength(count);
    expect(
      Object.values(firstStream.messages)
        .filter((message) => message.type === 'telemetry.accepted')
        .map((message) => message.eventId)
        .sort(),
    ).toEqual([...oracle.accepted_event_ids].sort());
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
      expect(Object.keys(stream.messages).sort()).toEqual(messageIds);
    }
    await expect.poll(domainCounts).toEqual({
      events: 20,
      vehicles: 8,
      alerts: 4,
      messages: 43,
      pending: 0,
    });
    await expect.poll(() => replayProof().runs[1]?.verification).toBe('conformant');
    const secondProof = replayProof();
    expect(secondProof.receipts).toHaveLength(sample.input * 2);
    expect(secondProof.attempts).toHaveLength(sample.input * 2);
    expect(secondProof.receipts.every((receipt) => receipt.state === 'complete')).toBe(true);
    expect(new Set(secondProof.attempts.map((attempt) => attempt.ingestion_id))).toEqual(
      new Set(secondProof.receipts.map((receipt) => receipt.ingestion_id)),
    );
    expect(
      secondProof.attempts.every(
        (attempt) =>
          attempt.state === 'classified' &&
          attempt.http_status === 200 &&
          attempt.batch_index === 0,
      ),
    ).toBe(true);
    expect(secondProof.runs).toHaveLength(2);
    expect(secondProof.runs[0].reportFingerprint).toBe(firstProof.runs[0].reportFingerprint);
    expect(secondProof.runs[1]).toMatchObject({
      stage: 'second',
      state: 'completed',
      verification: 'conformant',
      scenario_id: firstProof.runs[0].scenario_id,
    });
    expect(secondProof.domainFingerprint).toBe(firstProof.domainFingerprint);
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
