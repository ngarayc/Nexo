import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requiredJobs, repository } from './policy.mjs';
import { validateGate } from './results.mjs';
import { validatePublication } from './publication-policy.mjs';

const sha = /^[a-f0-9]{40}$/u;
const positive = (value) => /^[1-9]\d*$/u.test(String(value ?? ''));
const exact = (value, keys) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Objeto ausente.');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Campos inesperados.');
};
export const hashReport = (contents) => createHash('sha256').update(contents).digest('hex');

export function ciRoute({ eventName, ref, profile }) {
  if (eventName === 'pull_request') return 'promotion';
  if (eventName === 'push') return ref === 'refs/heads/development' ? 'full' : 'promotion';
  if (eventName === 'workflow_dispatch' && ref === 'refs/heads/development') {
    if (profile === 'full') return 'full';
    if (profile === 'expanded') return 'expanded';
  }
  throw new Error('Evento, rama o perfil de CI no permitido.');
}

export function validateEvidenceRun(run, { source, workflowId }) {
  assert.ok(positive(workflowId) && positive(run?.id) && positive(run?.run_attempt));
  assert.ok(sha.test(source));
  assert.equal(run.workflow_id, workflowId, 'Workflow de origen diferente.');
  assert.equal(run.path, '.github/workflows/ci.yml', 'Ruta de workflow diferente.');
  assert.equal(run.repository?.full_name, repository, 'Repositorio de ejecución diferente.');
  assert.equal(run.head_repository?.full_name, repository, 'Origen de ejecución diferente.');
  assert.equal(run.head_sha, source, 'Fuente de ejecución diferente.');
  assert.equal(run.head_branch, 'development', 'La evidencia debe proceder de development.');
  assert.ok(['push', 'workflow_dispatch'].includes(run.event), 'Evento de origen inválido.');
  assert.equal(run.status, 'completed', 'La ejecución de origen no ha terminado.');
  assert.equal(run.conclusion, 'success', 'La ejecución de origen no está aprobada.');
}

export function validateEvidenceJobs(jobs, run) {
  assert.ok(Array.isArray(jobs));
  const expected = [...requiredJobs, 'ci-required'];
  const ordinary = jobs.filter((job) => job.name !== 'expanded');
  const expanded = jobs.filter((job) => job.name === 'expanded');
  assert.ok(
    expanded.length <= 1 && expanded.every((job) => job.conclusion === 'skipped'),
    'Ejecución ampliada inesperada.',
  );
  assert.equal(ordinary.length, expected.length, 'Inventario de jobs de origen diferente.');
  for (const name of expected) {
    const matches = jobs.filter((job) => job.name === name);
    assert.equal(matches.length, 1, 'Job de origen ausente o duplicado.');
    const job = matches[0];
    assert.equal(job.run_id, run.id);
    assert.equal(job.head_sha, run.head_sha);
    assert.equal(job.status, 'completed');
    assert.equal(job.conclusion, 'success', 'Job de origen omitido o fallido.');
    if (name !== 'ci-required') {
      assert.equal(
        job.steps?.filter(
          (step) =>
            step.name === 'Verificar publicación y exclusión' && step.conclusion === 'success',
        ).length,
        1,
        'Falta la comprobación de publicación del origen.',
      );
    }
  }
}

export function validateEvidenceArtifacts(response, run) {
  assert.equal(response?.total_count, requiredJobs.length);
  assert.equal(response.artifacts?.length, requiredJobs.length);
  const ids = new Set();
  return requiredJobs.map((job) => {
    const name = `ci-${job}-${run.id}-${run.run_attempt}`;
    const found = response.artifacts.filter((artifact) => artifact.name === name);
    assert.equal(found.length, 1, 'Artefacto de origen ausente o duplicado.');
    const artifact = found[0];
    assert.ok(positive(artifact.id) && !ids.has(artifact.id));
    ids.add(artifact.id);
    assert.equal(artifact.expired, false, 'El artefacto de origen ha caducado.');
    assert.equal(artifact.workflow_run?.id, run.id);
    assert.equal(artifact.workflow_run?.head_sha, run.head_sha);
    assert.equal(artifact.workflow_run?.head_branch, 'development');
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/u, 'Digest de artefacto ausente.');
    assert.ok(
      Number.isSafeInteger(artifact.size_in_bytes) &&
        artifact.size_in_bytes > 0 &&
        artifact.size_in_bytes <= 65536,
    );
    return { job, artifact };
  });
}

export function validateReusedReports(entries, run) {
  const parsed = validatePublication(entries, 'gate');
  const reports = Object.fromEntries(requiredJobs.map((job) => [job, parsed.get(job + '.json')]));
  validateGate({
    results: Object.fromEntries(requiredJobs.map((job) => [job, 'success'])),
    reports,
    sha: run.head_sha,
    runId: String(run.id),
    attempt: String(run.run_attempt),
  });
  return requiredJobs.map((job) => ({
    job,
    sha256: hashReport(entries.find((entry) => entry.name === job + '.json').contents),
  }));
}

export function validatePromotionManifest(report, expected) {
  exact(report, [
    'version',
    'kind',
    'repository',
    'candidate',
    'tree',
    'event',
    'source',
    'target',
    'execution',
    'evidence',
    'reports',
    'status',
  ]);
  assert.equal(report.version, 1);
  assert.equal(report.kind, 'ci-promotion');
  assert.equal(report.repository, repository);
  assert.equal(report.status, 'passed');
  assert.match(report.candidate, sha);
  assert.match(report.tree, sha);
  assert.ok(['push', 'pull_request'].includes(report.event));
  assert.ok(
    (report.source === 'development' && report.target === 'test') ||
      (report.source === 'test' && report.target === 'main') ||
      (report.event === 'push' &&
        report.source === report.target &&
        ['test', 'main'].includes(report.target)),
  );
  exact(report.execution, ['runId', 'attempt']);
  exact(report.evidence, ['source', 'runId', 'attempt']);
  assert.match(report.evidence.source, sha);
  for (const value of [
    report.execution.runId,
    report.execution.attempt,
    report.evidence.runId,
    report.evidence.attempt,
  ])
    assert.ok(typeof value === 'string' && positive(value));
  assert.equal(report.reports?.length, requiredJobs.length);
  assert.deepEqual(report.reports.map((entry) => entry.job).sort(), [...requiredJobs].sort());
  for (const entry of report.reports) {
    exact(entry, ['job', 'sha256']);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  }
  for (const key of ['candidate', 'tree', 'event', 'source', 'target'])
    assert.equal(report[key], expected[key], 'Manifiesto de otra promoción.');
  assert.deepEqual(report.execution, expected.execution, 'Ejecución de promoción diferente.');
  return report;
}
