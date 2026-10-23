import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repository, validateContext } from './policy.mjs';
import {
  hashReport,
  validateEvidenceRun,
  validateEvidenceJobs,
  validateEvidenceArtifacts,
  validateReusedReports,
  validatePromotionManifest,
} from './promotion-evidence.mjs';

const prefix = `repos/${repository}/`;

export function verifySourceEvidence({ candidate, head, git, api, download, readArchive }) {
  assert.match(candidate, /^[a-f0-9]{40}$/u);
  assert.match(head, /^[a-f0-9]{40}$/u);
  git('merge-base', '--is-ancestor', head, candidate);
  const tree = git('rev-parse', candidate + '^{tree}');
  const workflow = api(prefix + 'actions/workflows/ci.yml');
  assert.equal(workflow.path, '.github/workflows/ci.yml');
  const history = git('log', '--format=%H %T', head).split('\n');
  let selected;
  for (const line of history) {
    const [source, sourceTree] = line.split(' ');
    if (sourceTree !== tree) continue;
    const response = api(
      prefix + `actions/workflows/ci.yml/runs?branch=development&head_sha=${source}&per_page=100`,
    );
    assert.ok(Array.isArray(response.workflow_runs), 'Consulta de ejecuciones inválida.');
    for (const run of response.workflow_runs) {
      if (!['push', 'workflow_dispatch'].includes(run.event)) continue;
      const attempt = String(run.run_attempt);
      assert.match(attempt, /^[1-9]\d*$/u);
      const response = api(prefix + `actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`);
      const jobs = response.jobs;
      assert.equal(response.total_count, jobs?.length, 'Inventario de jobs truncado.');
      // Un dispatch exclusivamente ampliado no sustituye la ejecución ordinaria.
      if (
        run.event === 'workflow_dispatch' &&
        jobs.some((job) => job.name === 'quality' && job.conclusion === 'skipped')
      )
        continue;
      selected = { run, jobs, source };
      break;
    }
    if (selected) break;
  }
  assert.ok(selected, 'No existe evidencia ordinaria de development para este árbol.');
  const { run, jobs, source } = selected;
  validateEvidenceRun(run, { source, workflowId: workflow.id });
  assert.equal(git('rev-parse', run.head_sha + '^{tree}'), tree, 'El árbol probado es distinto.');
  git('merge-base', '--is-ancestor', run.head_sha, head);
  validateEvidenceJobs(jobs, run);
  const artifacts = validateEvidenceArtifacts(
    api(prefix + `actions/runs/${run.id}/artifacts?per_page=100`),
    run,
  );
  const entries = artifacts.map(({ job, artifact }) => {
    const archive = download(prefix + `actions/artifacts/${artifact.id}/zip`);
    assert.ok(Buffer.isBuffer(archive) && archive.length === artifact.size_in_bytes);
    assert.equal(
      'sha256:' + hashReport(archive),
      artifact.digest,
      'Digest de artefacto diferente.',
    );
    return { name: job + '.json', contents: readArchive(archive, job + '.json') };
  });
  const reports = validateReusedReports(entries, run);
  const current = api(prefix + `actions/runs/${run.id}`);
  validateEvidenceRun(current, { source, workflowId: workflow.id });
  assert.equal(current.run_attempt, run.run_attempt, 'El intento cambió durante la verificación.');
  return {
    tree,
    evidence: { source: run.head_sha, runId: String(run.id), attempt: String(run.run_attempt) },
    reports,
  };
}

export function promotionEvidence({ env = process.env, git, api, download, readArchive }) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const context = validateContext({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    repositoryName: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
  });
  assert.ok(
    context.promotion || ['test', 'main'].includes(context.target),
    'Contexto de promoción requerido.',
  );
  assert.equal(git('rev-parse', 'HEAD'), env.GITHUB_SHA);
  assert.equal(
    git('status', '--porcelain'),
    '',
    'Fuentes modificadas antes de verificar promoción.',
  );
  const source = verifySourceEvidence({
    candidate: env.GITHUB_SHA,
    head: context.head,
    git,
    api,
    download,
    readArchive,
  });
  const report = {
    version: 1,
    kind: 'ci-promotion',
    repository,
    candidate: env.GITHUB_SHA,
    tree: source.tree,
    event: env.GITHUB_EVENT_NAME,
    source: context.source,
    target: context.target,
    execution: { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT },
    evidence: source.evidence,
    reports: source.reports,
    status: 'passed',
  };
  assert.equal(git('rev-parse', 'HEAD'), env.GITHUB_SHA);
  assert.equal(git('status', '--porcelain'), '', 'Fuentes modificadas durante la verificación.');
  validatePromotionManifest(report, report);
  return report;
}

export function evidenceTransport() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 15000 }).trim();
  const call = (endpoint) => {
    try {
      return execFileSync('gh', ['api', endpoint], {
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error('No fue posible consultar o descargar la evidencia de GitHub.');
    }
  };
  return {
    git,
    api: (endpoint) => JSON.parse(call(endpoint).toString('utf8')),
    download: call,
    readArchive(archive, name) {
      const directory = resolve('reports/raw/promotion', randomUUID());
      mkdirSync(directory, { recursive: true });
      const file = directory + '/artifact.zip';
      writeFileSync(file, archive);
      const files = execFileSync('unzip', ['-Z1', file], {
        encoding: 'utf8',
        maxBuffer: 65536,
        timeout: 10000,
      })
        .trim()
        .split('\n');
      assert.ok(
        files.length === 1 && files[0] === name,
        'El ZIP contiene archivos adicionales o rutas inesperadas.',
      );
      return execFileSync('unzip', ['-p', file, name], {
        encoding: 'utf8',
        maxBuffer: 65536,
        timeout: 10000,
      });
    },
  };
}
