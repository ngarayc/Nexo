import assert from 'node:assert/strict';
import { repository, requiredJobs } from '../ci/policy.mjs';

export const shaPattern = /^[a-f0-9]{40}$/u;
export const cdCondition =
  "${{ github.repository == 'ngarayc/Nexo' && github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository)) }}";
export const deployCondition = "${{ steps.proof.outputs.deploy == 'true' }}";

export function deploymentCandidate({ eventName, event, ref, checkout, latest, repo }) {
  assert.equal(repo, repository);
  assert.equal(ref, 'refs/heads/main');
  assert.match(checkout, shaPattern);
  assert.match(latest, shaPattern);
  if (eventName === 'workflow_run') {
    const run = event.workflow_run;
    assert.equal(run?.event, 'push');
    assert.equal(run.head_branch, 'main');
    assert.equal(run.head_sha, checkout);
    assert.equal(run.head_repository?.full_name, repository);
    assert.equal(run.status, 'completed');
    assert.equal(run.conclusion, 'success');
    assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  } else assert.equal(eventName, 'workflow_dispatch');
  return { sha: checkout, deploy: checkout === latest };
}

export function validateMainRun(run, sha) {
  assert.equal(run?.path, '.github/workflows/ci.yml');
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, 'push');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, sha);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
}

export function validateMainJobs(response, run) {
  assert.equal(response.total_count, response.jobs?.length);
  const jobs = response.jobs;
  assert.equal(jobs.length, requiredJobs.length + 2);
  for (const name of [...requiredJobs, 'expanded', 'ci-required']) {
    const own = jobs.filter((job) => job.name === name);
    assert.equal(own.length, 1);
    assert.equal(own[0].run_id, run.id);
    assert.equal(own[0].head_sha, run.head_sha);
    assert.equal(own[0].status, 'completed');
    assert.equal(own[0].conclusion, name === 'ci-required' ? 'success' : 'skipped');
  }
}

export function runCommandStdout(response) {
  assert.ok(Array.isArray(response?.value));
  const stdout = response.value.filter((item) => item.code === 'ComponentStatus/StdOut/succeeded');
  const linux = response.value.filter((item) => item.code === 'ProvisioningState/succeeded');
  if (stdout.length === 1 && linux.length === 0) return stdout[0].message;
  assert.ok(stdout.length === 0 && linux.length === 1, 'Respuesta ambigua del agente VM.');
  const message = linux[0].message;
  assert.equal(typeof message, 'string');
  assert.ok(message.startsWith('Enable succeeded: '));
  const start = message.indexOf('\n[stdout]\n');
  const end = message.indexOf('\n[stderr]\n');
  assert.ok(
    start >= 0 &&
      end > start &&
      start === message.lastIndexOf('\n[stdout]\n') &&
      end === message.lastIndexOf('\n[stderr]\n'),
    'Respuesta Linux incompleta.',
  );
  return message.slice(start + '\n[stdout]\n'.length, end);
}

export function readDeploymentResult(response, sha) {
  const lines = runCommandStdout(response).trim().split('\n');
  const result = JSON.parse(lines.at(-1));
  assert.equal(result.nexoDeployment, 1);
  assert.equal(result.sha, sha);
  assert.ok(
    ['deployed', 'already_current'].includes(result.status),
    'La VM no confirmó el despliegue.',
  );
  assert.equal(result.healthy, true);
  assert.deepEqual(Object.keys(result.images).sort(), ['api', 'db', 'gateway', 'web']);
  for (const image of Object.values(result.images)) assert.match(image, /^sha256:[a-f0-9]{64}$/u);
  return result;
}

export function validateCdWorkflow(workflow) {
  assert.equal(workflow.name, 'CD Azure');
  assert.deepEqual(Object.keys(workflow.on).sort(), ['workflow_dispatch', 'workflow_run']);
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ['CI'],
    types: ['completed'],
    branches: ['main'],
  });
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.deepEqual(workflow.permissions, {
    contents: 'read',
    actions: 'read',
    'pull-requests': 'read',
  });
  assert.deepEqual(workflow.concurrency, { group: 'nexo-azure-main', 'cancel-in-progress': false });
  assert.deepEqual(Object.keys(workflow.jobs), ['verify', 'deploy']);
  const verify = workflow.jobs.verify;
  assert.equal(verify.if, cdCondition);
  assert.equal(verify.environment, undefined);
  assert.equal(verify.permissions, undefined);
  assert.equal(verify.steps.length, 3);
  assert.equal(verify.steps[0].with.ref, '${{ github.event.workflow_run.head_sha || github.sha }}');
  assert.equal(verify.steps[0].with['fetch-depth'], 0);
  assert.equal(verify.steps[0].with['persist-credentials'], false);
  assert.equal(verify.steps[2].id, 'proof');
  assert.equal(verify.steps[2].run, 'node scripts/cd/verify.mjs');
  assert.equal(verify.steps[2].if, undefined);
  assert.equal(verify.steps[2].env, undefined);
  assert.deepEqual(verify.outputs, {
    deploy: '${{ steps.proof.outputs.deploy }}',
    sha: '${{ steps.proof.outputs.sha }}',
  });
  for (const step of verify.steps) {
    assert.equal(step['continue-on-error'], undefined);
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/u);
  }
  const job = workflow.jobs.deploy;
  assert.equal(job.needs, 'verify');
  assert.equal(job.if, "${{ needs.verify.outputs.deploy == 'true' }}");
  assert.equal(job.environment.name, 'azure-demo');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 45);
  assert.equal(job['continue-on-error'], undefined);
  assert.deepEqual(job.permissions, {
    contents: 'read',
    actions: 'read',
    'pull-requests': 'read',
    'id-token': 'write',
  });
  assert.equal(job.env.NEXO_REQUIRE_CURRENT, 'true');
  const steps = job.steps;
  assert.equal(steps.length, 5);
  for (const step of steps) {
    assert.equal(step['continue-on-error'], undefined);
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/u);
    assert.ok(!step.uses?.includes('upload-artifact'));
  }
  assert.equal(steps[0].with['fetch-depth'], 0);
  assert.ok(steps[0].uses.startsWith('actions/checkout@'));
  assert.ok(steps[1].uses.startsWith('actions/setup-node@'));
  assert.equal(steps[1].with['node-version-file'], '.nvmrc');
  assert.equal(steps[0].with['persist-credentials'], false);
  assert.equal(steps[0].with.ref, '${{ needs.verify.outputs.sha }}');
  const proof = steps.findIndex((step) => step.id === 'proof');
  const login = steps.findIndex((step) => step.uses?.startsWith('azure/login@'));
  assert.equal(proof, 2);
  assert.equal(login, 3);
  assert.equal(steps[proof].run, 'node scripts/cd/verify.mjs');
  assert.equal(steps[proof].if, undefined);
  assert.equal(steps[proof].env, undefined);
  for (const step of steps.slice(login)) assert.equal(step.if, deployCondition);
  assert.equal(steps.at(-1).run, 'node scripts/cd/deploy.mjs');
  assert.ok(!JSON.stringify(workflow).includes('secrets.AZURE_CREDENTIALS'));
}
