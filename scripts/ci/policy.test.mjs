import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  issueReferences,
  repository,
  validateContext,
  validateIssue,
  validatePromotion,
} from './policy.mjs';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const prEvent = (source = 'development', target = 'test') => ({
  eventName: 'pull_request',
  repositoryName: repository,
  sha: head,
  event: {
    pull_request: {
      head: { ref: source, sha: head, repo: { full_name: repository } },
      base: { ref: target, sha: base, repo: { full_name: repository } },
    },
  },
});

test('admite únicamente las dos promociones entre ramas permanentes', () => {
  for (const [source, target] of [
    ['development', 'test'],
    ['test', 'main'],
  ]) {
    assert.equal(validateContext(prEvent(source, target)).source, source);
  }
  for (const [source, target] of [
    ['development', 'main'],
    ['main', 'test'],
    ['feature', 'test'],
    ['test', 'development'],
  ]) {
    assert.throws(() => validateContext(prEvent(source, target)));
  }
});

test('rechaza forks y repositorios diferentes aunque coincidan nombres de rama', () => {
  const fork = prEvent();
  fork.event.pull_request.head.repo.full_name = 'another/Nexo';
  assert.throws(() => validateContext(fork));
  assert.throws(() => validateContext({ ...prEvent(), repositoryName: 'another/Nexo' }));
});

test('rechaza SHA y metadatos ausentes de una PR', () => {
  const invalid = prEvent();
  invalid.event.pull_request.base.sha = 'main';
  assert.throws(() => validateContext(invalid));
  assert.throws(() => validateContext({ ...prEvent(), event: {} }));
  assert.throws(() => validateContext({ ...prEvent(), sha: '--all' }));
});

test('el push identifica exactamente el rango y una rama permanente', () => {
  const push = {
    eventName: 'push',
    repositoryName: repository,
    ref: 'refs/heads/development',
    sha: head,
    event: { before: base, after: head, deleted: false },
  };
  assert.equal(validateContext(push).base, base);
  assert.equal(
    validateContext({ ...push, event: { before: '0'.repeat(40), after: head } }).base,
    undefined,
  );
  assert.throws(() => validateContext({ ...push, ref: 'refs/tags/main' }));
  assert.throws(() => validateContext({ ...push, event: { ...push.event, deleted: true } }));
  assert.throws(() => validateContext({ ...push, event: { ...push.event, after: base } }));
});

test('un evento no reconocido o un despacho sobre tag no habilita CI', () => {
  assert.throws(() => validateContext({ ...prEvent(), eventName: 'pull_request_target' }));
  assert.throws(() =>
    validateContext({
      ...prEvent(),
      eventName: 'workflow_dispatch',
      ref: 'refs/tags/entrega-final',
    }),
  );
});

test('Refs es un trailer explícito y admite varias issues sin duplicarlas', () => {
  assert.deepEqual(issueReferences('feat: cambio\n\nRefs #2, #3\nRefs #2\n'), [2, 3]);
  for (const message of [
    'feat: #2',
    'Closes #2',
    'Refs #0',
    'Refs #2 extra',
    'Refs #-1',
    'Refs #9007199254740992',
  ]) {
    assert.throws(() => issueReferences(message));
  }
});

test('Refs admite un único punto final sin aceptar referencias parciales o puntuación intermedia', () => {
  assert.deepEqual(issueReferences('feat: cambio\n\nRefs #57, #59.\n'), [57, 59]);
  assert.deepEqual(issueReferences('Refs #2.\nRefs #3, #2\n'), [2, 3]);
  for (const message of [
    'Refs #0.',
    'Refs #-1.',
    'Refs #01.',
    'Refs #2..',
    'Refs #2.5',
    'Refs #2 .',
    'Refs #2, #3.extra',
    'Refs #2., #3',
    'Refs #2, #3. extra',
    'Refs #9007199254740992.',
  ])
    assert.throws(() => issueReferences(message));
});

test('un número de PR, una issue ajena o inexistente no sirve de trazabilidad', () => {
  const issue = {
    number: 2,
    repository_url: `https://api.github.com/repos/${repository}`,
    state: 'open',
  };
  validateIssue(issue, 2);
  validateIssue({ ...issue, state: 'closed' }, 2);
  assert.throws(() => validateIssue({ ...issue, pull_request: { url: 'pr' } }, 2));
  assert.throws(() =>
    validateIssue({ ...issue, repository_url: 'https://api.github.com/repos/other/Nexo' }, 2),
  );
  assert.throws(() => validateIssue(undefined, 2));
  assert.throws(() => validateIssue(issue, 3));
});

test('un push de promoción necesita la PR integrada y el merge exacto', () => {
  const promotion = {
    merged_at: '2026-10-20T00:00:00Z',
    merge_commit_sha: head,
    base: { ref: 'test', repo: { full_name: repository } },
    head: { ref: 'development', repo: { full_name: repository } },
  };
  validatePromotion([promotion], { target: 'test', head });
  assert.throws(() => validatePromotion([], { target: 'test', head }));
  assert.throws(() =>
    validatePromotion([{ ...promotion, merged_at: null }], { target: 'test', head }),
  );
  assert.throws(() => validatePromotion([promotion], { target: 'main', head }));
  assert.throws(() => validatePromotion([promotion], { target: 'test', head: base }));
});
