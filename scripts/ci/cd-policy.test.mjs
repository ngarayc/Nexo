import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  deploymentCandidate,
  validateMainRun,
  validateMainJobs,
  readDeploymentResult,
  validateCdWorkflow,
} from '../cd/policy.mjs';
import { requiredJobs } from './policy.mjs';

const sha = 'a'.repeat(40);
const run = () => ({
  id: 101,
  run_attempt: 1,
  path: '.github/workflows/ci.yml',
  repository: { full_name: 'ngarayc/Nexo' },
  head_repository: { full_name: 'ngarayc/Nexo' },
  head_branch: 'main',
  head_sha: sha,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
});
const context = () => ({
  eventName: 'workflow_run',
  event: { workflow_run: run() },
  ref: 'refs/heads/main',
  checkout: sha,
  latest: sha,
  repo: 'ngarayc/Nexo',
});

test('CD solo admite main propio y CI completo; un candidato sustituido no se despliega', () => {
  assert.deepEqual(deploymentCandidate(context()), { sha, deploy: true });
  assert.equal(deploymentCandidate({ ...context(), latest: 'b'.repeat(40) }).deploy, false);
  assert.equal(
    deploymentCandidate({ ...context(), eventName: 'workflow_dispatch', event: {} }).deploy,
    true,
  );
  for (const change of [
    { eventName: 'pull_request' },
    { ref: 'refs/heads/development' },
    { repo: 'foreign/Nexo' },
    { checkout: 'main' },
    { latest: 'invalid' },
  ])
    assert.throws(() => deploymentCandidate({ ...context(), ...change }));
  for (const change of [
    { head_branch: 'test' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'foreign/Nexo' } },
    { head_sha: 'b'.repeat(40) },
  ])
    assert.throws(() => validateMainRun({ ...run(), ...change }, sha));
});

test('el CI de main debe conservar promoción aprobada y suites omitidas por reutilización', () => {
  const jobs = [...requiredJobs, 'expanded', 'ci-required'].map((name) => ({
    name,
    run_id: 101,
    head_sha: sha,
    status: 'completed',
    conclusion: name === 'ci-required' ? 'success' : 'skipped',
  }));
  validateMainJobs({ jobs, total_count: jobs.length }, run());
  for (const change of [
    { jobs: jobs.slice(1), total_count: jobs.length - 1 },
    { jobs: [...jobs, jobs[0]], total_count: jobs.length + 1 },
    {
      jobs: jobs.map((j) => (j.name === 'ci-required' ? { ...j, conclusion: 'skipped' } : j)),
      total_count: jobs.length,
    },
    {
      jobs: jobs.map((j) => (j.name === 'system' ? { ...j, conclusion: 'success' } : j)),
      total_count: jobs.length,
    },
  ])
    assert.throws(() => validateMainJobs(change, run()));
});

test('HTTP200 del agente Azure no demuestra despliegue: exige marcador, SHA, salud y cuatro imágenes', () => {
  const result = {
    nexoDeployment: 1,
    status: 'deployed',
    sha,
    healthy: true,
    images: Object.fromEntries(
      ['api', 'web', 'db', 'gateway'].map((name) => [name, 'sha256:' + 'c'.repeat(64)]),
    ),
  };
  const response = (value) => ({
    value: [{ code: 'ComponentStatus/StdOut/succeeded', message: JSON.stringify(value) + '\n' }],
  });
  assert.deepEqual(readDeploymentResult(response(result), sha), result);
  const linux = {
    value: [
      {
        code: 'ProvisioningState/succeeded',
        message: 'Enable succeeded: \n[stdout]\n' + JSON.stringify(result) + '\n\n[stderr]\n',
      },
    ],
  };
  assert.deepEqual(readDeploymentResult(linux, sha), result);
  assert.throws(() =>
    readDeploymentResult(
      { value: [{ code: 'ProvisioningState/succeeded', message: JSON.stringify(result) }] },
      sha,
    ),
  );
  assert.throws(() =>
    readDeploymentResult(
      { value: [{ code: 'ProvisioningState/failed', message: linux.value[0].message }] },
      sha,
    ),
  );
  for (const change of [
    { status: 'failed' },
    { status: 'rolled_back' },
    { sha: 'b'.repeat(40) },
    { healthy: false },
    { images: { api: 'sha256:' + 'c'.repeat(64) } },
  ])
    assert.throws(() => readDeploymentResult(response({ ...result, ...change }), sha));
  assert.throws(() =>
    readDeploymentResult(
      {
        value: [{ code: 'ComponentStatus/StdOut/succeeded', message: 'azure operation completed' }],
      },
      sha,
    ),
  );
});

test('workflow real protege OIDC, verifica antes del login, fija SHA y serializa sin cancelar', () => {
  const workflow = () => parse(readFileSync('.github/workflows/cd.yml', 'utf8'));
  validateCdWorkflow(workflow());
  for (const mutate of [
    (w) => {
      w.permissions.contents = 'write';
    },
    (w) => {
      w.concurrency['cancel-in-progress'] = true;
    },
    (w) => {
      w.on.push = { branches: ['main'] };
    },
    (w) => {
      w.jobs.deploy.if = '${{ always() }}';
    },
    (w) => {
      w.jobs.deploy.environment.name = 'test';
    },
    (w) => {
      w.jobs.deploy.steps[0].with.ref = 'main';
    },
    (w) => {
      w.jobs.deploy.steps[3].if = undefined;
    },
    (w) => {
      w.jobs.deploy.steps[2].if = '${{ false }}';
    },
    (w) => {
      w.jobs.deploy.steps[2].env = { GITHUB_SHA: sha };
    },
    (w) => {
      w.jobs.deploy.steps[3]['continue-on-error'] = true;
    },
    (w) => {
      w.jobs.deploy.steps[3].uses = 'azure/login@v2';
    },
    (w) => {
      w.jobs.deploy.steps.push({ run: 'untrusted' });
    },
  ]) {
    const value = workflow();
    mutate(value);
    assert.throws(() => validateCdWorkflow(value));
  }
});
