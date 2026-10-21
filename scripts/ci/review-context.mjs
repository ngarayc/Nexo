import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateContext } from './policy.mjs';

const context = validateContext({
  eventName: process.env.GITHUB_EVENT_NAME,
  event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
  repositoryName: process.env.GITHUB_REPOSITORY,
  ref: process.env.GITHUB_REF,
  sha: process.env.GITHUB_SHA,
});
if (
  !context.promotion ||
  context.target !== 'main' ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== process.env.GITHUB_SHA
) {
  throw new Error('Contexto de revisión hacia main inválido.');
}
console.log(`Fuente revisada: ${context.head}. Integración evaluada: ${process.env.GITHUB_SHA}.`);
