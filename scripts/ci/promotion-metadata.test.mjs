import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promotionMetadata } from './promotion-metadata.mjs';
import { repository, validatePromotion } from './policy.mjs';

const commit = 'a'.repeat(40),
  parents = ['b'.repeat(40), 'c'.repeat(40)];
const message = 'Merge pull request #53 from ngarayc/development\n\nfeature';
const pr = () => ({
  number: 53,
  merged_at: '2026-10-22T00:00:00Z',
  merge_commit_sha: commit,
  base: { ref: 'test', repo: { full_name: repository } },
  head: { ref: 'development', repo: { full_name: repository } },
});
test('merge estándar localiza PR directamente y exige su metadata remota', () => {
  const calls = [];
  const pulls = promotionMetadata({
    commit,
    message,
    parents,
    api: (endpoint) => {
      calls.push(endpoint);
      return pr();
    },
  });
  assert.deepEqual(calls, [`repos/${repository}/pulls/53`]);
  validatePromotion(pulls, { target: 'test', head: commit });
});
test('un número sugerido en el mensaje no habilita PR distinta, pendiente, de otroSHA/fork/flujo', () => {
  for (const mutate of [
    (p) => (p.number = 54),
    (p) => (p.merged_at = null),
    (p) => (p.merge_commit_sha = 'd'.repeat(40)),
    (p) => (p.head.repo.full_name = 'other/Nexo'),
    (p) => (p.base.ref = 'main'),
    (p) => (p.head.ref = 'feature'),
  ]) {
    const value = pr();
    mutate(value);
    assert.throws(() =>
      validatePromotion(promotionMetadata({ commit, message, parents, api: () => value }), {
        target: 'test',
        head: commit,
      }),
    );
  }
});
test('texto sin formato reconocido o sin dos padres conserva asociación remota y bloqueo', () => {
  for (const change of [
    { message: 'forged #53' },
    { message: 'prefix\n' + message },
    { message: 'Merge pull request #53 from another/development' },
    { parents: [parents[0]] },
  ]) {
    const calls = [];
    const pulls = promotionMetadata({
      commit,
      message,
      parents,
      ...change,
      api: (endpoint) => {
        calls.push(endpoint);
        return [];
      },
    });
    assert.deepEqual(calls, [`repos/${repository}/commits/${commit}/pulls?per_page=100`]);
    assert.throws(() => validatePromotion(pulls, { target: 'test', head: commit }));
  }
});
test('API vacía, fallida o número no representable no se convierten en autorización', () => {
  for (const api of [
    () => {
      throw new Error('unavailable');
    },
    () => undefined,
    () => ({}),
  ])
    assert.throws(() => promotionMetadata({ commit, message, parents, api }));
  assert.throws(() =>
    promotionMetadata({
      commit,
      message: 'Merge pull request #9007199254740992 from ngarayc/development',
      parents,
      api: () => pr(),
    }),
  );
  assert.throws(() => promotionMetadata({ commit: '--all', message, parents, api: () => pr() }));
  assert.throws(() => promotionMetadata({ commit, message: 'custom', parents, api: () => ({}) }));
});
