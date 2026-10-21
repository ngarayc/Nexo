import { readFile, readdir } from 'node:fs/promises';
import { requiredJobs } from './policy.mjs';
import { validateGate } from './results.mjs';

const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');
const files = await readdir('reports/ci');
if (
  files.length !== requiredJobs.length ||
  files.some((file) => !requiredJobs.includes(file.replace(/\.json$/, '')))
) {
  throw new Error('Inventario de reportes incompleto o inesperado.');
}
const reports = Object.fromEntries(
  await Promise.all(
    requiredJobs.map(async (job) => [
      job,
      JSON.parse(await readFile(`reports/ci/${job}.json`, 'utf8')),
    ]),
  ),
);
validateGate({
  results: Object.fromEntries(requiredJobs.map((job) => [job, needs[job]?.result])),
  reports,
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
});
console.log('ci-required: cinco controles y sus reportes aprobados para este candidato e intento.');
