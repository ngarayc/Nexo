import { execFileSync } from 'node:child_process';
import { isAbsolute, basename, dirname } from 'node:path';

export function systemApiScript(source) {
  const project = process.env.NEXO_SYSTEM_PROJECT;
  const envFile = process.env.NEXO_SYSTEM_ENV_FILE;
  if (
    !/^nexo-e0-check-[a-f0-9]{12}$/.test(project ?? '') ||
    !envFile ||
    !isAbsolute(envFile) ||
    basename(envFile) !== 'environment' ||
    !basename(dirname(envFile)).startsWith('nexo-test-config-')
  )
    throw new Error('Falta el stack sintético propio del runner de sistema.');
  try {
    return execFileSync(
      'docker',
      [
        'compose',
        '--project-name',
        project,
        '--env-file',
        envFile,
        '-f',
        'infra/compose.yaml',
        'exec',
        '-T',
        'api',
        'node',
        '--input-type=module',
        '-e',
        source,
      ],
      { encoding: 'utf8', timeout: 35000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    throw new Error('No se completó la comprobación del stack sintético de sistema.');
  }
}
