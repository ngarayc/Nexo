import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repository } from './policy.mjs';
import { verifySyncMerge } from './sync-merge.mjs';

const commit = 'a'.repeat(40),
  parents = ['b'.repeat(40), 'c'.repeat(40)],
  tree = 'd'.repeat(40),
  message = "Merge branch 'test' into development";
function fixture() {
  const pr = {
    base: { ref: 'test', repo: { full_name: repository } },
    head: { ref: 'development', repo: { full_name: repository } },
  };
  const remote = {
    sha: commit,
    committer: { login: 'web-flow' },
    commit: { message, tree: { sha: tree }, verification: { verified: true, reason: 'valid' } },
    parents: parents.map((sha) => ({ sha })),
  };
  const promotion = {
    ...JSON.parse(JSON.stringify(pr)),
    merged_at: '2026-10-24T00:00:00Z',
    merge_commit_sha: parents[1],
  };
  return {
    remote,
    pr,
    promotion,
    input: {
      commit,
      parents,
      message,
      git: (operation, revision) => {
        assert.equal(operation, 'rev-parse');
        assert.ok([commit, parents[0]].some((sha) => revision === sha + '^{tree}'));
        return tree;
      },
      api: (endpoint) => {
        if (endpoint === `repos/${repository}/commits/${commit}`) return remote;
        assert.equal(endpoint, `repos/${repository}/commits/${commit}/pulls?per_page=100`);
        return [pr];
      },
      promotionPulls: (sha) => {
        assert.equal(sha, parents[1]);
        return [promotion];
      },
    },
  };
}

test('sincronización firmada por GitHub conserva árbol y acredita PR y promoción del segundo padre', () => {
  assert.equal(verifySyncMerge(fixture().input), true);
});

test('texto propio, flujo distinto o trailers añadidos no se reconocen como sincronización', () => {
  for (const text of [
    'custom merge',
    "Merge branch 'main' into development",
    message + '\nRefs #109',
  ])
    assert.equal(
      verifySyncMerge({
        ...fixture().input,
        message: text,
        api: () => assert.fail('API innecesaria'),
      }),
      false,
    );
});

test('rechaza contenido modificado, identidad o firma falsa y padres discrepantes', () => {
  for (const mutate of [
    (f) => {
      f.input.git = (_, revision) => (revision.startsWith(commit) ? tree : 'e'.repeat(40));
    },
    (f) => {
      f.input.parents = [parents[0]];
    },
    (f) => {
      f.remote.sha = parents[0];
    },
    (f) => {
      f.remote.committer.login = 'ngarayc';
    },
    (f) => {
      f.remote.commit.verification.verified = false;
    },
    (f) => {
      f.remote.commit.verification.reason = 'unsigned';
    },
    (f) => {
      f.remote.commit.message = 'forged';
    },
    (f) => {
      f.remote.commit.tree.sha = 'e'.repeat(40);
    },
    (f) => {
      f.remote.parents.reverse();
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => verifySyncMerge(f.input));
  }
});

test('rechaza forks, flujo ajeno y segundo padre que no es una promoción integrada a test', () => {
  for (const mutate of [
    (f) => {
      f.pr.base.repo.full_name = 'other/Nexo';
    },
    (f) => {
      f.pr.head.repo.full_name = 'other/Nexo';
    },
    (f) => {
      f.pr.base.ref = 'main';
    },
    (f) => {
      f.pr.head.ref = 'feature';
    },
    (f) => {
      f.promotion.merged_at = null;
    },
    (f) => {
      f.promotion.merge_commit_sha = commit;
    },
    (f) => {
      f.promotion.head.ref = 'feature';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => verifySyncMerge(f.input));
  }
});

test('API fallida, vacía o inventario no comprobable bloquea', () => {
  for (const value of [undefined, {}, []])
    assert.throws(() => verifySyncMerge({ ...fixture().input, api: () => value }));
  assert.throws(() =>
    verifySyncMerge({
      ...fixture().input,
      api: () => {
        throw new Error('unavailable');
      },
    }),
  );
  assert.throws(() => verifySyncMerge({ ...fixture().input, promotionPulls: () => [] }));
});
