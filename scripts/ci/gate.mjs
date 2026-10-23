import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { requiredJobs } from './policy.mjs';
import { validateGate } from './results.mjs';
import { validatePublication } from './publication-policy.mjs';
import { ciRoute } from './promotion-evidence.mjs';
import { evidenceTransport, promotionEvidence } from './reuse-evidence.mjs';
import { verifyTraceability } from './traceability.mjs';

const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const route = ciRoute({
  eventName: process.env.GITHUB_EVENT_NAME,
  ref: process.env.GITHUB_REF,
  profile: event.inputs?.profile,
});
if (route === 'promotion') {
  if (requiredJobs.some((job) => needs[job]?.result !== 'skipped'))
    throw new Error('La promoción no debe volver a ejecutar suites.');
  verifyTraceability();
  const report = promotionEvidence(evidenceTransport());
  await mkdir('reports/promotion', { recursive: true });
  await writeFile('reports/promotion/manifest.json', JSON.stringify(report) + '\n');
  console.log(
    'ci-required: evidencia de development verificada; suites reutilizadas para el mismo árbol.',
  );
} else if (route === 'full') {
  if (requiredJobs.some((job) => needs[job]?.result !== 'success'))
    throw new Error('Controles ordinarios incompletos o fallidos.');
  const files = await readdir('reports/ci');
  if (
    files.length !== requiredJobs.length ||
    files.some((file) => !requiredJobs.includes(file.replace(/\.json$/, '')))
  ) {
    throw new Error('Inventario de reportes incompleto o inesperado.');
  }
  const downloaded = validatePublication(
    await Promise.all(
      files.map(async (name) => ({
        name,
        contents: await readFile('reports/ci/' + name, 'utf8'),
      })),
    ),
    'gate',
  );
  const reports = Object.fromEntries(
    requiredJobs.map((job) => [job, downloaded.get(job + '.json')]),
  );
  validateGate({
    results: Object.fromEntries(requiredJobs.map((job) => [job, needs[job]?.result])),
    reports,
    sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  console.log(
    'ci-required: cinco controles y sus reportes aprobados para este candidato e intento.',
  );
} else {
  throw new Error('El perfil ampliado dispone de su propia ejecución.');
}
