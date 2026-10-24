import assert from 'node:assert/strict';
import { repository, validatePromotion } from './policy.mjs';

export function verifySyncMerge({ commit, message, parents, git, api, promotionPulls }) {
  if (message.trim() !== "Merge branch 'test' into development") return false;
  assert.match(commit, /^[a-f0-9]{40}$/u);
  assert.equal(parents.length, 2);
  for (const parent of parents) assert.match(parent, /^[a-f0-9]{40}$/u);
  const tree = git('rev-parse', commit + '^{tree}');
  assert.equal(
    tree,
    git('rev-parse', parents[0] + '^{tree}'),
    'La sincronización modifica archivos.',
  );

  // El texto no autoriza el merge: GitHub debe acreditar firma, padres y PR.
  const remote = api(`repos/${repository}/commits/${commit}`);
  assert.equal(remote?.sha, commit);
  assert.equal(remote?.committer?.login, 'web-flow');
  assert.equal(remote?.commit?.verification?.verified, true);
  assert.equal(remote?.commit?.verification?.reason, 'valid');
  assert.equal(remote?.commit?.message?.trim(), message.trim());
  assert.equal(remote?.commit?.tree?.sha, tree);
  assert.deepEqual(
    remote?.parents?.map((parent) => parent.sha),
    parents,
  );
  const pulls = api(`repos/${repository}/commits/${commit}/pulls?per_page=100`);
  assert.ok(Array.isArray(pulls));
  assert.ok(
    pulls.some(
      (pr) =>
        pr.base?.ref === 'test' &&
        pr.head?.ref === 'development' &&
        pr.base?.repo?.full_name === repository &&
        pr.head?.repo?.full_name === repository,
    ),
    'La sincronización no pertenece a una PR development → test.',
  );
  validatePromotion(promotionPulls(parents[1]), { target: 'test', head: parents[1] });
  return true;
}
