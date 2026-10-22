import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { testStack } from '../../tests/support/stack.mjs';
import { validatePlaywrightReport } from './results.mjs';

const stack = testStack({ webPort: 8081 });
await rm('reports/system-summary.json', { force: true });
await rm('reports/playwright-raw.json', { force: true });
try {
  stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
  execFileSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
    env: { ...process.env, ...stack.browserEnvironment() },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });
  const report = JSON.parse(await readFile('reports/playwright-raw.json', 'utf8'));
  const inventory = (await readdir('tests/system', { recursive: true })).filter((file) =>
    file.endsWith('.spec.mjs'),
  );
  const tests = validatePlaywrightReport(report, inventory);
  await mkdir('reports', { recursive: true });
  await writeFile('reports/system-summary.json', JSON.stringify(tests) + '\n');
  console.log(`system: ${tests.passed} pruebas de navegador aprobadas; ninguna omitida.`);
} catch {
  console.error(
    'Recorrido de sistema no aprobado; no se publica el reporte crudo ni se emite resumen satisfactorio.',
  );
  process.exitCode = 1;
} finally {
  stack.close();
}
