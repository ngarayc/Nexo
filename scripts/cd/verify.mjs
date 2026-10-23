import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { repository, validatePromotion } from '../ci/policy.mjs';
import { evidenceTransport, verifySourceEvidence } from '../ci/reuse-evidence.mjs';
import { hashReport, validatePromotionManifest } from '../ci/promotion-evidence.mjs';
import { validatePublication } from '../ci/publication-policy.mjs';
import { promotionMetadata } from '../ci/promotion-metadata.mjs';
import { deploymentCandidate, validateMainRun, validateMainJobs } from './policy.mjs';

const transport = evidenceTransport();
const { git, api, download, readArchive } = transport;
const prefix = `repos/${repository}/`;
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const sha = git('rev-parse', 'HEAD');
const latest = api(prefix + 'git/ref/heads/main').object.sha;
const candidate = deploymentCandidate({
  eventName: process.env.GITHUB_EVENT_NAME,
  event,
  ref: process.env.GITHUB_REF,
  checkout: sha,
  latest,
  repo: process.env.GITHUB_REPOSITORY,
});
assert.equal(git('status', '--porcelain'), '');
if (!candidate.deploy) {
  assert.notEqual(
    process.env.NEXO_REQUIRE_CURRENT,
    'true',
    'Main cambió antes de autenticar en Azure.',
  );
  appendFileSync(process.env.GITHUB_OUTPUT, 'deploy=false\n');
  console.log('Candidato sustituido por otro main; no se despliega.');
} else {
  const workflow = api(prefix + 'actions/workflows/ci.yml');
  const runs =
    process.env.GITHUB_EVENT_NAME === 'workflow_run'
      ? [event.workflow_run]
      : api(
          prefix +
            `actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`,
        ).workflow_runs;
  assert.ok(Array.isArray(runs) && runs.length > 0);
  const run = api(prefix + 'actions/runs/' + [...runs].sort((a, b) => b.id - a.id)[0].id);
  validateMainRun(run, sha);
  assert.equal(run.workflow_id, workflow.id);
  validateMainJobs(
    api(prefix + `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`),
    run,
  );
  const pulls = promotionMetadata({
    commit: sha,
    message: git('show', '--no-patch', '--format=%B', sha),
    parents: git('show', '--no-patch', '--format=%P', sha).split(' '),
    api,
  });
  validatePromotion(pulls, { target: 'main', head: sha });
  const artifacts = api(prefix + `actions/runs/${run.id}/artifacts?per_page=100`);
  assert.equal(artifacts.total_count, 1);
  assert.equal(artifacts.artifacts.length, 1);
  const artifact = artifacts.artifacts[0];
  assert.equal(artifact.name, `promotion-${run.id}-${run.run_attempt}`);
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run.id, run.id);
  assert.equal(artifact.workflow_run.head_sha, sha);
  assert.ok(artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 65536);
  const archive = download(prefix + `actions/artifacts/${artifact.id}/zip`);
  assert.equal(archive.length, artifact.size_in_bytes);
  assert.equal('sha256:' + hashReport(archive), artifact.digest);
  const contents = readArchive(archive, 'manifest.json');
  const manifest = validatePublication([{ name: 'manifest.json', contents }], 'promotion').get(
    'manifest.json',
  );
  const proof = verifySourceEvidence({ candidate: sha, head: sha, ...transport });
  validatePromotionManifest(manifest, {
    candidate: sha,
    tree: proof.tree,
    event: 'push',
    source: 'main',
    target: 'main',
    execution: { runId: String(run.id), attempt: String(run.run_attempt) },
  });
  assert.deepEqual(manifest.evidence, proof.evidence);
  assert.deepEqual(manifest.reports, proof.reports);
  const sourceDigest = execFileSync('python3', ['scripts/cd/azure-vm.py', 'manifest', '.'], {
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
  assert.match(sourceDigest, /^[a-f0-9]{64}$/u);
  assert.equal(
    api(prefix + 'git/ref/heads/main').object.sha,
    sha,
    'Main cambió durante la verificación.',
  );
  mkdirSync('reports/cd', { recursive: true });
  writeFileSync(
    'reports/cd/verification.json',
    JSON.stringify({ sha, sourceDigest, ciRun: run.id, manifest }) + '\n',
    { mode: 0o600 },
  );
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `deploy=true\nsha=${sha}\nsource_digest=${sourceDigest}\n`,
  );
  console.log('Main, promoción y cinco artefactos verificados. No se repiten suites.');
}
