import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { preparePublication } from './publication-policy.mjs';
import { validateReport } from './results.mjs';
import { validateExpandedManifest } from './expanded-policy.mjs';

try {
  const scope = process.argv[2];
  const source = process.env.GITHUB_SHA;
  if (
    !/^[0-9a-f]{40}$/.test(source ?? '') ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== source
  )
    throw new Error('Contexto de publicación inválido.');
  const reports = await preparePublication(scope);
  const execution = {
    kind: 'github',
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  if (scope === 'expanded') {
    const fixtures = {};
    for (const [key, path] of [
      ['events', 'events.jsonl'],
      ['sample', 'expected_sample.json'],
      ['detailed', 'expected_detailed.json'],
    ])
      fixtures[key] = createHash('sha256')
        .update(await readFile('fixtures/' + path))
        .digest('hex');
    const images = ['api', 'web', 'db'].map((name) => {
      const [id, revision] = execFileSync(
        'docker',
        [
          'image',
          'inspect',
          'nexo-' + name + ':local',
          '--format',
          '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}',
        ],
        { encoding: 'utf8' },
      )
        .trim()
        .split(/\s/u);
      return { name, id, revision, scan: 'passed' };
    });
    const files = (await readdir('tests/system'))
      .filter((file) => file.endsWith('.spec.mjs'))
      .sort();
    const report = reports.get('manifest.json');
    if (source !== process.env.NEXO_CANDIDATE || report.stage !== process.env.NEXO_STAGE)
      throw new Error('Candidato de publicación ampliada distinto.');
    validateExpandedManifest(report, { source, execution, files, fixtures, images });
  } else {
    validateReport(reports.get(scope + '.json'), {
      job: scope,
      sha: source,
      runId: execution.runId,
      attempt: execution.attempt,
    });
  }
  console.log('Publicación: adjunto sintético excluido y contenido permitido comprobado.');
} catch {
  // Un archivo inválido puede contener datos sensibles: no propagar su texto.
  console.error('Publicación rechazada; revisar el control y su diagnóstico privado.');
  process.exitCode = 1;
}
