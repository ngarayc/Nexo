import { run } from 'node:test';
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pressureFailureStage } from './failure-diagnostics.mjs';

const scope = process.argv[2];
const directory =
  scope === 'ci-controls'
    ? 'scripts/ci'
    : scope === 'integration'
      ? 'tests/integration'
      : undefined;
if (!directory) throw new Error('Selecciona ci-controls o integration.');
await rm(`reports/${scope}-summary.json`, { force: true });
const files = (await readdir(directory))
  .filter((file) => file.endsWith('.test.mjs'))
  .map((file) => resolve(directory, file));
if (files.length === 0) throw new Error('Inventario de pruebas vacío.');
const observed = new Set();
let summary;
// La integración incorpora el recorrido acumulado de 10k y su repetición.
for await (const event of run({
  files,
  concurrency: false,
  timeout: scope === 'integration' ? 360000 : 180000,
})) {
  if (event.type === 'test:fail') {
    const file = relative(process.cwd(), event.data.file ?? directory);
    console.error(`Prueba fallida: ${file}:${event.data.line ?? 0}`);
    if (file === 'tests/integration/realtime-pressure.test.mjs') {
      const stage = pressureFailureStage(event.data.details?.error);
      if (stage !== undefined) console.error(`Etapa de presión SSE: ${stage}.`);
    }
  }
  if (event.type === 'test:summary') {
    if (event.data.file) {
      if (!event.data.success || event.data.counts.tests === 0) process.exitCode = 1;
      observed.add(resolve(event.data.file));
    } else {
      summary = event.data;
    }
  }
}
const counts = summary?.counts;
if (
  process.exitCode ||
  !summary?.success ||
  !counts ||
  counts.tests <= 0 ||
  counts.passed !== counts.tests ||
  counts.failed ||
  counts.cancelled ||
  counts.skipped ||
  counts.todo ||
  files.some((file) => !observed.has(file))
) {
  console.error(
    'Pruebas incompletas, vacías, omitidas o fallidas. No se emite resumen aprobatorio.',
  );
  process.exitCode = 1;
} else {
  const result = { total: counts.tests, passed: counts.passed, failed: 0, skipped: 0 };
  await mkdir('reports', { recursive: true });
  await writeFile(`reports/${scope}-summary.json`, JSON.stringify(result) + '\n');
  console.log(`${scope}: ${result.passed} pruebas aprobadas; ninguna omitida.`);
}
