import { repository } from './policy.mjs';

// El mensaje solo localiza un candidato. validatePromotion conserva la decisión
// basada en metadata remota y el SHA exacto; el texto no acredita una promoción.
export function promotionMetadata({ commit, message, parents, api }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Commit de promoción inválido.');
  const firstLine = message.split(/\r?\n/, 1)[0];
  const match = /^Merge pull request #([1-9]\d*) from ngarayc\/(development|test)$/.exec(firstLine);
  if (match && parents.length === 2 && parents.every((parent) => /^[a-f0-9]{40}$/.test(parent))) {
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number)) throw new Error('Número de PR inválido.');
    const pr = api(`repos/${repository}/pulls/${number}`);
    if (pr?.number !== number) throw new Error('La API no confirmó la PR solicitada.');
    return [pr];
  }
  const pulls = api(`repos/${repository}/commits/${commit}/pulls?per_page=100`);
  if (!Array.isArray(pulls)) throw new Error('Asociación commit/PR no comprobable.');
  return pulls;
}
