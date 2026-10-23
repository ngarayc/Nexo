import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requiredJobs, repository } from './policy.mjs';
import { verifySourceEvidence, evidenceTransport } from './reuse-evidence.mjs';
import {
  fullCondition,
  expandedCondition,
  promotionCondition,
  gateCondition,
} from './workflow-policy.mjs';
import {
  ciRoute,
  hashReport,
  validateEvidenceRun,
  validateEvidenceJobs,
  validateEvidenceArtifacts,
  validateReusedReports,
  validatePromotionManifest,
} from './promotion-evidence.mjs';

const source = 'a'.repeat(40),
  candidate = 'b'.repeat(40),
  tree = 'c'.repeat(40);
const fixture = () => {
  const run = {
    id: 100,
    run_attempt: 1,
    workflow_id: 10,
    path: '.github/workflows/ci.yml',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    head_sha: source,
    head_branch: 'development',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const jobs = [...requiredJobs, 'ci-required'].map((name) => ({
    name,
    run_id: run.id,
    head_sha: source,
    status: 'completed',
    conclusion: 'success',
    steps: [{ name: 'Verificar publicación y exclusión', conclusion: 'success' }],
  }));
  const names = {
    quality: ['workspace-quality', 'traceability', 'ci-controls'],
    unit: ['api', 'web'],
    integration: ['postgresql'],
    'security-source': ['secrets', 'dependencies', 'configuration'],
    system: ['images', 'browser', 'persistence'],
  };
  const entries = requiredJobs.map((job) => ({
    name: job + '.json',
    contents:
      JSON.stringify({
        version: 1,
        job,
        sha: source,
        runId: '100',
        attempt: '1',
        checks: names[job].map((name) => ({
          name,
          status: 'passed',
          ...(['api', 'web', 'postgresql', 'browser'].includes(name)
            ? { tests: { total: 1, passed: 1, failed: 0, skipped: 0 } }
            : {}),
        })),
      }) + '\n',
  }));
  const archives = entries.map((entry) => Buffer.from(entry.contents));
  const artifacts = {
    total_count: 5,
    artifacts: requiredJobs.map((job, i) => ({
      id: 1000 + i,
      name: `ci-${job}-100-1`,
      expired: false,
      workflow_run: { id: 100, head_sha: source, head_branch: 'development' },
      digest: 'sha256:' + hashReport(archives[i]),
      size_in_bytes: archives[i].length,
    })),
  };
  const git = (...args) => {
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'log') return `${candidate} ${tree}\n${source} ${tree}`;
    if (args[0] === 'rev-parse') return tree;
    throw new Error('Consulta Git inesperada.');
  };
  const api = (endpoint) => {
    if (endpoint.endsWith('actions/workflows/ci.yml'))
      return { id: 10, path: '.github/workflows/ci.yml' };
    if (endpoint.includes('/runs?'))
      return { workflow_runs: endpoint.includes(source) ? [run] : [] };
    if (endpoint.includes('/jobs?')) return { total_count: jobs.length, jobs };
    if (endpoint.includes('/artifacts?')) return artifacts;
    if (endpoint.endsWith('/runs/100')) return run;
    throw new Error('Consulta API inesperada.');
  };
  const dependencies = {
    candidate,
    head: candidate,
    git,
    api,
    download: (endpoint) => archives[Number(endpoint.split('/').at(-2)) - 1000],
    readArchive: (archive) => archive.toString('utf8'),
  };
  return { run, jobs, entries, archives, artifacts, dependencies };
};

test('las rutas completas, promociones y ampliado son disjuntas; el despacho ampliado exige development', () => {
  assert.equal(ciRoute({ eventName: 'push', ref: 'refs/heads/development' }), 'full');
  assert.equal(
    ciRoute({ eventName: 'workflow_dispatch', ref: 'refs/heads/development', profile: 'full' }),
    'full',
  );
  assert.equal(
    ciRoute({ eventName: 'workflow_dispatch', ref: 'refs/heads/development', profile: 'expanded' }),
    'expanded',
  );
  assert.equal(ciRoute({ eventName: 'pull_request' }), 'promotion');
  for (const ref of ['test', 'main'])
    assert.equal(ciRoute({ eventName: 'push', ref: 'refs/heads/' + ref }), 'promotion');
  for (const changes of [
    { eventName: 'pull_request_target' },
    { eventName: 'workflow_dispatch', ref: 'refs/heads/main', profile: 'expanded' },
    { eventName: 'workflow_dispatch', ref: 'refs/heads/development', profile: 'other' },
  ])
    assert.throws(() => ciRoute(changes));
});

test('el origen exige repositorio, rama, workflow, SHA e intento realmente aprobados', () => {
  const { run } = fixture();
  const expected = { source, workflowId: 10 };
  validateEvidenceRun(run, expected);
  for (const changes of [
    { workflow_id: 11 },
    { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'other/Nexo' } },
    { head_repository: { full_name: 'other/Nexo' } },
    { head_sha: candidate },
    { head_branch: 'test' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'cancelled' },
    { run_attempt: 0 },
  ])
    assert.throws(() => validateEvidenceRun({ ...run, ...changes }, expected));
});

test('jobs y prueba de exclusión no admiten fallos, skips, duplicados o evidencia incompleta', () => {
  for (const mutate of [
    (f) => f.jobs.pop(),
    (f) => f.jobs.push(f.jobs[0]),
    (f) => {
      f.jobs[1].conclusion = 'skipped';
    },
    (f) => {
      f.jobs[1].head_sha = candidate;
    },
    (f) => {
      f.jobs[1].run_id = 99;
    },
    (f) => {
      f.jobs[0].steps = [];
    },
    (f) => {
      f.jobs[0].steps[0].conclusion = 'skipped';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateEvidenceJobs(f.jobs, f.run));
  }
  const f = fixture();
  f.jobs.push({ name: 'expanded', conclusion: 'skipped' });
  validateEvidenceJobs(f.jobs, f.run);
  f.jobs.at(-1).conclusion = 'success';
  assert.throws(() => validateEvidenceJobs(f.jobs, f.run));
});

test('los cinco artefactos deben pertenecer al intento y conservar digest, identidad y vigencia', () => {
  for (const mutate of [
    (f) => f.artifacts.artifacts.pop(),
    (f) => {
      f.artifacts.total_count = 6;
    },
    (f) => {
      f.artifacts.artifacts[0].name = 'ci-quality-100-2';
    },
    (f) => {
      f.artifacts.artifacts[0].expired = true;
    },
    (f) => {
      f.artifacts.artifacts[0].workflow_run.head_sha = candidate;
    },
    (f) => {
      f.artifacts.artifacts[0].id = f.artifacts.artifacts[1].id;
    },
    (f) => {
      f.artifacts.artifacts[0].digest = undefined;
    },
    (f) => {
      f.artifacts.artifacts[0].size_in_bytes = 1000000;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateEvidenceArtifacts(f.artifacts, f.run));
  }
});

test('se conservan los SHA e intento originales; un reporte relabelado, omitido o con campos crudos bloquea', () => {
  const f = fixture();
  assert.equal(validateReusedReports(f.entries, f.run).length, 5);
  for (const mutation of [
    (r) => {
      r.sha = candidate;
    },
    (r) => {
      r.attempt = '2';
    },
    (r) => {
      r.checks[0].status = 'skipped';
    },
    (r) => {
      r.cookie = 'synthetic';
    },
  ]) {
    const entries = globalThis.structuredClone(f.entries),
      r = JSON.parse(entries[0].contents);
    mutation(r);
    entries[0].contents = JSON.stringify(r);
    assert.throws(() => validateReusedReports(entries, f.run));
  }
});

test('la resolución reutiliza cinco archivos íntegros y rechaza cambios de árbol, ZIP, intento o fallo más reciente', () => {
  const f = fixture();
  const result = verifySourceEvidence(f.dependencies);
  assert.deepEqual(result.evidence, { source, runId: '100', attempt: '1' });
  assert.equal(result.tree, tree);
  assert.equal(result.reports.length, 5);
  for (const change of [
    (d) => {
      const git = d.git;
      d.git = (...args) => (args[0] === 'log' ? `${source} ${'d'.repeat(40)}` : git(...args));
    },
    (d) => {
      d.download = () => Buffer.from('altered');
    },
    (d) => {
      const download = d.download;
      d.download = (endpoint) => {
        const bytes = Buffer.from(download(endpoint));
        bytes[bytes.length - 1] = 32;
        return bytes;
      };
    },
    (d) => {
      const api = d.api;
      d.api = (endpoint) =>
        endpoint.endsWith('/runs/100') ? { ...api(endpoint), run_attempt: 2 } : api(endpoint);
    },
    (d) => {
      const api = d.api;
      d.api = (endpoint) =>
        endpoint.includes('/runs?')
          ? { workflow_runs: [{ ...f.run, conclusion: 'failure' }, f.run] }
          : api(endpoint);
    },
  ]) {
    const d = { ...f.dependencies };
    change(d);
    assert.throws(() => verifySourceEvidence(d));
  }
});

test('la igualdad de contenido se comprueba con Git real: merge de árbol igual pasa y archivo nuevo bloquea', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-promotion-'));
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git('init', '--initial-branch=development');
    git('config', 'user.name', 'Synthetic test');
    git('config', 'user.email', 'synthetic@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(directory, 'content'), 'base');
    git('add', 'content');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('branch', 'test');
    writeFileSync(join(directory, 'content'), 'candidate');
    git('commit', '-am', 'candidate');
    const tested = git('rev-parse', 'HEAD');
    git('checkout', 'test');
    git('merge', '--no-ff', 'development', '-m', 'promotion');
    const promoted = git('rev-parse', 'HEAD');
    assert.notEqual(tested, promoted);
    assert.equal(git('rev-parse', tested + '^{tree}'), git('rev-parse', promoted + '^{tree}'));
    git('merge-base', '--is-ancestor', tested, promoted);
    const actualHistory = git('log', '--format=%H %T', promoted);
    assert.ok(actualHistory.includes(tested + ' ' + git('rev-parse', promoted + '^{tree}')));
    writeFileSync(join(directory, 'extra'), 'changed');
    git('add', 'extra');
    git('commit', '-m', 'change');
    assert.notEqual(git('rev-parse', 'HEAD^{tree}'), git('rev-parse', tested + '^{tree}'));
    assert.throws(() => git('merge-base', '--is-ancestor', promoted, base));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('un ZIP real solo admite el JSON esperado: rechaza adjuntos y rutas', () => {
  // ZIPs sintéticos fijos: JSON único, adjunto adicional, nombre distinto y subruta.
  const archives = [
    'UEsDBBQAAAAAAPyxVl1Dv6ajAgAAAAIAAAAMAAAAcXVhbGl0eS5qc29ue31QSwECFAMUAAAAAAD8sVZdQ7+mowIAAAACAAAADAAAAAAAAAAAAAAAgAEAAAAAcXVhbGl0eS5qc29uUEsFBgAAAAABAAEAOgAAACwAAAAAAA==',
    'UEsDBBQAAAAAAPyxVl1Dv6ajAgAAAAIAAAAMAAAAcXVhbGl0eS5qc29ue31QSwMEFAAAAAAA/LFWXUO/pqMCAAAAAgAAAAUAAABleHRyYXt9UEsBAhQDFAAAAAAA/LFWXUO/pqMCAAAAAgAAAAwAAAAAAAAAAAAAAIABAAAAAHF1YWxpdHkuanNvblBLAQIUAxQAAAAAAPyxVl1Dv6ajAgAAAAIAAAAFAAAAAAAAAAAAAACAASwAAABleHRyYVBLBQYAAAAAAgACAG0AAABRAAAAAAA=',
    'UEsDBBQAAAAAAPyxVl1Dv6ajAgAAAAIAAAAFAAAAZXh0cmF7fVBLAQIUAxQAAAAAAPyxVl1Dv6ajAgAAAAIAAAAFAAAAAAAAAAAAAACAAQAAAABleHRyYVBLBQYAAAAAAQABADMAAAAlAAAAAAA=',
    'UEsDBBQAAAAAAPyxVl1Dv6ajAgAAAAIAAAATAAAAbmVzdGVkL3F1YWxpdHkuanNvbnt9UEsBAhQDFAAAAAAA/LFWXUO/pqMCAAAAAgAAABMAAAAAAAAAAAAAAIABAAAAAG5lc3RlZC9xdWFsaXR5Lmpzb25QSwUGAAAAAAEAAQBBAAAAMwAAAAAA',
  ].map((value) => Buffer.from(value, 'base64'));
  const readArchive = evidenceTransport().readArchive;
  assert.equal(readArchive(archives[0], 'quality.json'), '{}');
  for (const archive of archives.slice(1))
    assert.throws(() => readArchive(archive, 'quality.json'));
});

test('el manifiesto separado vincula promoción y evidencia sin admitir otra ejecución o campos privados', () => {
  const f = fixture();
  const report = {
    version: 1,
    kind: 'ci-promotion',
    repository,
    candidate,
    tree,
    event: 'pull_request',
    source: 'development',
    target: 'test',
    execution: { runId: '200', attempt: '1' },
    evidence: { source, runId: '100', attempt: '1' },
    reports: validateReusedReports(f.entries, f.run),
    status: 'passed',
  };
  validatePromotionManifest(report, report);
  for (const mutate of [
    (r) => {
      r.candidate = source;
    },
    (r) => {
      r.tree = source;
    },
    (r) => {
      r.execution.attempt = '2';
    },
    (r) => {
      r.evidence.raw = 'synthetic';
    },
    (r) => {
      r.reports[0].cookie = 'synthetic';
    },
    (r) => {
      r.source = 'main';
    },
    (r) => {
      r.reports.pop();
    },
  ]) {
    const other = globalThis.structuredClone(report);
    mutate(other);
    assert.throws(() => validatePromotionManifest(other, report));
  }
});

test('las expresiones efectivas de Actions ejecutan una única ruta por evento y mantienen su agregado', () => {
  const evaluate = (expression, event, ref, profile) =>
    Boolean(
      Function(
        'github',
        'inputs',
        'always',
        'return ' + expression.slice(3, -2),
      )({ event_name: event, ref }, { profile }, () => true),
    );
  for (const [event, ref, profile, expected] of [
    ['push', 'development', undefined, 'full'],
    ['pull_request', 'pull/89/merge', undefined, 'promotion'],
    ['push', 'test', undefined, 'promotion'],
    ['push', 'main', undefined, 'promotion'],
    ['workflow_dispatch', 'development', 'full', 'full'],
    ['workflow_dispatch', 'development', 'expanded', 'expanded'],
  ]) {
    const active = [fullCondition, promotionCondition, expandedCondition].map((expression) =>
      evaluate(expression, event, 'refs/heads/' + ref, profile),
    );
    assert.equal(active.filter(Boolean).length, 1);
    assert.equal(['full', 'promotion', 'expanded'][active.indexOf(true)], expected);
    assert.equal(
      evaluate(gateCondition, event, 'refs/heads/' + ref, profile),
      expected !== 'expanded',
    );
  }
});
