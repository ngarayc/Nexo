import { chromium } from '@playwright/test';
import { missingBrowserDependencies } from './browser-setup.mjs';

let browser;
let state;
try {
  if (process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS)
    throw new Error('La validación nativa debe permanecer habilitada.');
  browser = await chromium.launch({ timeout: 15000 });
  const page = await browser.newPage();
  await page.goto('about:blank', { timeout: 5000 });
  await page.setContent('<p>Nexo: navegador disponible</p>', { timeout: 5000 });
  const value = await page
    .getByText('Nexo: navegador disponible', { exact: true })
    .textContent({ timeout: 5000 });
  if (value !== 'Nexo: navegador disponible') throw new Error('DOM no comprobable.');
  state = 'ready';
} catch (error) {
  state = missingBrowserDependencies(error) ? 'missing-dependencies' : 'failed';
} finally {
  try {
    await browser?.close();
  } catch {
    state = 'failed';
  }
}
console.log(JSON.stringify({ state }));
process.exitCode = state === 'ready' ? 0 : state === 'missing-dependencies' ? 2 : 1;
