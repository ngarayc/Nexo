import { test, expect } from '../support/browser-test.mjs';
import { signIn } from '../support/browser-session.mjs';
import { domainCounts, replayProof } from '../support/system-operator.mjs';
import { systemApiScript } from '../support/system-runtime.mjs';

test('limpieza confirmada conserva cuenta, vacía dos clientes y permite otro par oficial', async ({
  browser,
}) => {
  test.setTimeout(150000);
  const one = await browser.newContext(),
    two = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const clear = (page) => page.getByRole('button', { name: 'Limpiar demostración', exact: true });
  const control = (page) => page.evaluate(async () => (await fetch('/api/demo/replay')).json());
  const reset = (page, view) =>
    page.evaluate(async (view) => {
      const session = await (await fetch('/api/session')).json();
      const response = await fetch('/api/demo/replay/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify({
          instanceId: view.instanceId,
          expectedControlVersion: view.controlVersion,
          confirmation: 'CLEAR_DEMO',
        }),
      });
      return { status: response.status, body: await response.json() };
    }, view);
  const sqlCheck = (mode) =>
    JSON.parse(
      systemApiScript(`
    import { Pool } from 'pg';
    import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
    const db = new Pool(readDatabaseConfig(process.env,true).pool);
    try {
      if (${JSON.stringify(mode)} === 'rollback') {
        await db.query('BEGIN'); await db.query('SELECT public.clear_demo_data()'); await db.query('ROLLBACK');
      }
      const row=(await db.query(\`SELECT
        (SELECT username FROM public.users) AS username,
        (SELECT id::text FROM public.users) AS id,
        (SELECT count(*)::int FROM pgboss.job WHERE name='telemetry.ingest') AS jobs,
        has_table_privilege('nexo_app','public.telemetry_events','TRUNCATE') AS truncate,
        has_table_privilege('nexo_app','public.users','UPDATE') AS update_user
      \`)).rows[0];
      console.log(JSON.stringify(row));
    } finally { await db.end(); }
  `),
    );
  try {
    const first = await one.newPage(),
      second = await two.newPage();
    for (const page of [first, second]) {
      await signIn(page);
      await expect(page.locator('.connection-status')).toHaveText('En vivo');
      await page.getByRole('button', { name: /^Reproductor ·/ }).click();
    }
    const account = sqlCheck('read');
    expect(account).toMatchObject({ username: 'demo', truncate: false, update_user: false });
    await first.getByLabel('Intervalo entre líneas (milisegundos)', { exact: true }).fill('100');
    await first.getByRole('button', { name: 'Iniciar reproducción', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Pausar', exact: true })).toBeEnabled();
    expect((await reset(first, await control(first))).body.code).toBe('DEMO_BUSY');
    for (const page of [first, second]) {
      await expect(page.getByTestId('replay-state')).toHaveText('Recorrido completado', {
        timeout: 60000,
      });
      await expect(page.getByTestId('replay-accepted')).toHaveText('20');
    }
    await expect.poll(() => domainCounts().pending).toBe(0);
    await first.getByRole('tab', { name: 'Informe', exact: true }).click();
    await expect(
      first.getByRole('heading', { name: 'Primera pasada correcta', exact: true }),
    ).toBeVisible();
    await expect(first.locator('.report-technical')).not.toHaveAttribute('open');
    await expect(first.locator('.report-expectation')).toContainText('20 registros nuevos');
    await first.screenshot({ path: 'reports/raw/demo-report-preview.png' });
    await first.getByRole('tab', { name: 'Control', exact: true }).click();
    const before = domainCounts();
    sqlCheck('rollback');
    expect(domainCounts()).toEqual(before);
    const stale = await control(first);
    await expect(clear(first)).toBeEnabled();
    await clear(first).click();
    await expect(first.getByRole('dialog')).toContainText('No se creará un respaldo');
    await first.getByRole('button', { name: 'Cancelar limpieza', exact: true }).click();
    expect(domainCounts()).toEqual(before);
    await clear(first).click();
    await first.getByRole('button', { name: 'Confirmar limpieza definitiva', exact: true }).click();
    for (const page of [first, second]) {
      await expect(page.locator('.connection-status')).toHaveText('En vivo', { timeout: 20000 });
      await expect(page.getByTestId('vehicle-total')).toHaveText('0');
      await expect(page.getByTestId('alert-total')).toHaveText('0');
      await expect(page.getByTestId('replay-state')).toHaveText('Listo para comenzar');
      await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
    }
    expect(domainCounts()).toEqual({ events: 0, vehicles: 0, alerts: 0, messages: 0, pending: 0 });
    expect(replayProof()).toMatchObject({ receipts: [], attempts: [], runs: [] });
    expect(sqlCheck('read')).toEqual({ ...account, jobs: 0 });
    await first.getByRole('button', { name: 'Iniciar reproducción', exact: true }).click();
    await expect(first.getByTestId('replay-state')).toHaveText('Recorrido completado', {
      timeout: 60000,
    });
    for (const [id, count] of [
      ['accepted', 20],
      ['duplicates', 2],
      ['rejected', 2],
    ])
      await expect(first.getByTestId('replay-' + id)).toHaveText(String(count));
    const firstRunId = (await control(first)).run.runId;
    await first.getByRole('button', { name: 'Reiniciar reproducción', exact: true }).click();
    await expect.poll(async () => (await control(first)).run?.runId).not.toBe(firstRunId);
    await expect
      .poll(async () => (await control(first)).run?.state, { timeout: 60000 })
      .toBe('completed');
    await expect(first.getByTestId('replay-state')).toHaveText('Recorrido completado', {
      timeout: 60000,
    });
    for (const [id, count] of [
      ['accepted', 0],
      ['duplicates', 22],
      ['rejected', 2],
    ])
      await expect(first.getByTestId('replay-' + id)).toHaveText(String(count));
    expect((await reset(first, stale)).status).toBe(409);
    expect(domainCounts()).toEqual({
      events: 20,
      vehicles: 8,
      alerts: 4,
      messages: 43,
      pending: 0,
    });
    await second.reload();
    await expect(second.locator('.connection-status')).toHaveText('En vivo');
    await expect(second.getByTestId('vehicle-total')).toHaveText('8');
  } finally {
    await one.close();
    await two.close();
  }
});
