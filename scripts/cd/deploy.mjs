import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { evidenceTransport } from '../ci/reuse-evidence.mjs';
import { readDeploymentResult } from './policy.mjs';
const proof = JSON.parse(readFileSync('reports/cd/verification.json', 'utf8'));
assert.match(proof.sha, /^[a-f0-9]{40}$/u);
assert.match(proof.sourceDigest, /^[a-f0-9]{64}$/u);
const env = process.env;
for (const key of ['AZURE_SUBSCRIPTION_ID', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID'])
  assert.match(env[key] ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu);
for (const key of ['AZURE_RESOURCE_GROUP', 'AZURE_VM_NAME'])
  assert.match(env[key] ?? '', /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u);
assert.match(env.NEXO_PUBLIC_ORIGIN ?? '', /^https:\/\/[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/u);
assert.equal(
  evidenceTransport().api('repos/ngarayc/Nexo/git/ref/heads/main').object.sha,
  proof.sha,
  'Main cambió antes de desplegar.',
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const script = readFileSync('scripts/cd/azure-vm.py', 'utf8');
assert.ok(!script.includes('\nNEXO_CDPY\n'));
const payload =
  '#!/bin/sh\nset -eu\npython3 - deploy ' +
  [proof.sha, proof.sourceDigest, env.NEXO_PUBLIC_ORIGIN].map(quote).join(' ') +
  " <<'NEXO_CDPY'\n" +
  script +
  '\nNEXO_CDPY\n';
writeFileSync('reports/cd/run-command.sh', payload, { mode: 0o600 });
const call = spawnSync(
  'az',
  [
    'vm',
    'run-command',
    'invoke',
    '--subscription',
    env.AZURE_SUBSCRIPTION_ID,
    '--resource-group',
    env.AZURE_RESOURCE_GROUP,
    '--name',
    env.AZURE_VM_NAME,
    '--command-id',
    'RunShellScript',
    '--scripts',
    '@reports/cd/run-command.sh',
    '--only-show-errors',
    '--output',
    'json',
  ],
  { encoding: 'utf8', timeout: 2400000, maxBuffer: 1024 * 1024 },
);
writeFileSync(
  'reports/cd/azure-cli.private.log',
  (call.stdout ?? '') + '\n' + (call.stderr ?? ''),
  { mode: 0o600 },
);
assert.equal(
  call.status,
  0,
  'No se pudo confirmar la ejecución del agente Azure. No repetir automáticamente.',
);
assert.ok(!call.signal && !call.error, 'Ejecución Azure inconclusa.');
const result = readDeploymentResult(JSON.parse(call.stdout), proof.sha);
writeFileSync('reports/cd/deployment.json', JSON.stringify(result) + '\n', { mode: 0o600 });
appendFileSync(
  env.GITHUB_STEP_SUMMARY,
  `Nexo actualizado desde main: \`${proof.sha}\`.\n\nHTTPS y las cuatro imágenes comprobados. Datos, cuenta y certificados conservados.\n`,
);
appendFileSync(
  env.GITHUB_STEP_SUMMARY,
  '\n| Servicio | Imagen ejecutada |\n| --- | --- |\n' +
    Object.entries(result.images)
      .map(([role, id]) => `| ${role} | \`${id}\` |`)
      .join('\n') +
    '\n',
);
console.log(`Despliegue confirmado desde main ${proof.sha}.`);
