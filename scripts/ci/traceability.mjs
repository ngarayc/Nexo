import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  issueReferences,
  repository,
  validateContext,
  validateIssue,
  validatePromotion,
} from './policy.mjs';

export function verifyTraceability(env = process.env) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const context = validateContext({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    repositoryName: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
  });
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 15000 }).trim();
  const api = (endpoint) => {
    try {
      return JSON.parse(
        execFileSync('gh', ['api', endpoint], {
          encoding: 'utf8',
          timeout: 20000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    } catch {
      throw new Error('No fue posible comprobar los metadatos de GitHub.');
    }
  };
  if (git('rev-parse', 'HEAD') !== env.GITHUB_SHA) {
    throw new Error('El checkout no corresponde al SHA que se está evaluando.');
  }
  if (env.GITHUB_EVENT_NAME === 'push' && context.target !== 'development') {
    validatePromotion(
      api(`repos/${repository}/commits/${context.head}/pulls?per_page=100`),
      context,
    );
  }
  const revision = context.base ? `${context.base}..${context.head}` : context.head;
  const commits = git('rev-list', '--reverse', revision).split('\n').filter(Boolean);
  const issues = new Set();
  let generatedMerges = 0;
  for (const commit of commits) {
    let numbers;
    try {
      numbers = issueReferences(git('show', '--no-patch', '--format=%B', commit));
    } catch {
      const parents = git('show', '--no-patch', '--format=%P', commit).split(' ');
      if (parents.length < 2) throw new Error('Un commit propio carece de Refs válido.');
      const pulls = api(`repos/${repository}/commits/${commit}/pulls?per_page=100`);
      const promotion = ['test', 'main'].some((target) => {
        try {
          validatePromotion(pulls, { target, head: commit });
          return true;
        } catch {
          return false;
        }
      });
      if (!promotion)
        throw new Error('Un merge propio carece de issue y no es una promoción de GitHub.');
      generatedMerges += 1;
      continue;
    }
    for (const number of numbers) {
      if (!issues.has(number)) validateIssue(api(`repos/${repository}/issues/${number}`), number);
      issues.add(number);
    }
  }
  // Una sincronización compuesta solo por merges puede tener cero commits propios.
  return {
    commitsChecked: commits.length,
    generatedMerges,
    issues: [...issues].sort((a, b) => a - b),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyTraceability()));
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Metadatos de evento inválidos.' : error.message);
    process.exitCode = 1;
  }
}
