import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { browserStack } from '../../tests/support/browser-stack.mjs';
import { validatePlaywrightReport } from './results.mjs';
import { browserFailureStage } from './failure-diagnostics.mjs';

await rm('reports/system-summary.json', { force: true });
const inventory = (await readdir('tests/system', { recursive: true }))
  .filter((file) => file.endsWith('.spec.mjs'))
  .sort();
if (!inventory.length) throw new Error('Inventario de navegador vacío.');
const directory = join('reports', 'raw', 'system', randomUUID());
await mkdir(directory, { recursive: true });
const records = [];
let failed = false;
let total = 0;
for (const file of inventory) {
  const stack = browserStack(file);
  const output = join(directory, file + '.json');
  const record = { file, report: output, status: 'failed' };
  try {
    await mkdir(dirname(output), { recursive: true });
    stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
    execFileSync(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', `tests/system/${file}`],
      {
        env: { ...process.env, ...stack.browserEnvironment(), NEXO_SYSTEM_REPORT: output },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180000,
      },
    );
    const report = JSON.parse(await readFile(output, 'utf8'));
    const tests = validatePlaywrightReport(report, [file]);
    total += tests.total;
    record.status = 'passed';
    console.log(`system: ${file}, ${tests.passed} casos aprobados.`);
  } catch {
    failed = true;
    let stage;
    try {
      stage = browserFailureStage(JSON.parse(await readFile(output, 'utf8')));
    } catch {
      /* Un proceso que no inició puede carecer de reporte. */
    }
    console.error(
      `system: ${file} no aprobado; su diagnóstico permanece privado.${stage ? ' Categoría: ' + stage + '.' : ''}`,
    );
  } finally {
    try {
      stack.close();
    } catch {
      failed = true;
      record.status = 'cleanup-failed';
    }
    records.push(record);
    await writeFile(
      'reports/raw/system/latest.json',
      JSON.stringify({ directory, records }) + '\n',
    );
  }
}
if (failed || records.length !== inventory.length || total <= 0) {
  console.error('Recorrido incompleto o fallido; no se emite resumen satisfactorio.');
  process.exitCode = 1;
} else {
  await writeFile(
    'reports/system-summary.json',
    JSON.stringify({ total, passed: total, failed: 0, skipped: 0 }) + '\n',
  );
  console.log(`system: ${total} pruebas de navegador aprobadas; ninguna omitida.`);
}
