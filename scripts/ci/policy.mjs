export const repository = 'ngarayc/Nexo';
export const permanentBranches = ['development', 'test', 'main'];
export const requiredJobs = ['quality', 'unit', 'integration', 'security-source', 'system'];

const shaPattern = /^[0-9a-f]{40}$/;

export function validateContext({ eventName, event, repositoryName, ref, sha }) {
  if (repositoryName !== repository || !shaPattern.test(sha)) {
    throw new Error('Repositorio o SHA de comprobación inválidos.');
  }
  if (eventName === 'pull_request') {
    const pr = event.pull_request;
    const source = pr?.head?.ref;
    const target = pr?.base?.ref;
    if (
      pr?.head?.repo?.full_name !== repository ||
      pr?.base?.repo?.full_name !== repository ||
      !(
        (source === 'development' && target === 'test') ||
        (source === 'test' && target === 'main')
      ) ||
      !shaPattern.test(pr?.head?.sha ?? '') ||
      !shaPattern.test(pr?.base?.sha ?? '')
    ) {
      throw new Error('La PR no respeta development → test → main.');
    }
    return { source, target, head: pr.head.sha, base: pr.base.sha, promotion: true };
  }
  if (eventName !== 'push' && eventName !== 'workflow_dispatch') {
    throw new Error('Evento de CI no permitido.');
  }
  const branch = ref?.replace(/^refs\/heads\//, '');
  if (!ref?.startsWith('refs/heads/') || !permanentBranches.includes(branch) || event.deleted) {
    throw new Error('Referencia de CI no permitida.');
  }
  if (eventName === 'push' && (!shaPattern.test(event.before ?? '') || event.after !== sha)) {
    throw new Error('El evento no identifica el rango publicado.');
  }
  return {
    source: branch,
    target: branch,
    head: sha,
    base: eventName === 'push' && !/^0{40}$/.test(event.before) ? event.before : undefined,
    promotion: false,
  };
}

export function issueReferences(message) {
  const references = new Set();
  for (const line of message.split(/\r?\n/)) {
    if (!/^Refs #[1-9]\d*(?:, (?:Refs )?#[1-9]\d*)*\.?$/.test(line)) continue;
    for (const match of line.matchAll(/#([1-9]\d*)/g)) {
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number)) throw new Error('Referencia de issue inválida.');
      references.add(number);
    }
  }
  if (references.size === 0) throw new Error('Falta un trailer Refs #<issue> válido.');
  return [...references].sort((a, b) => a - b);
}

export function validateIssue(issue, number) {
  if (
    issue?.number !== number ||
    issue.pull_request ||
    issue.repository_url !== `https://api.github.com/repos/${repository}` ||
    !['open', 'closed'].includes(issue.state)
  ) {
    throw new Error('La referencia no corresponde a una issue real de Nexo.');
  }
}

export function validatePromotion(pulls, { target, head }) {
  const source = target === 'test' ? 'development' : target === 'main' ? 'test' : undefined;
  if (
    !source ||
    !pulls.some(
      (pr) =>
        pr.merged_at &&
        pr.merge_commit_sha === head &&
        pr.base?.ref === target &&
        pr.head?.ref === source &&
        pr.base?.repo?.full_name === repository &&
        pr.head?.repo?.full_name === repository,
    )
  ) {
    throw new Error('El push de promoción no procede de una PR integrada por el flujo permitido.');
  }
}
