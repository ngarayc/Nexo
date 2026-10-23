import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { requiredJobs } from './policy.mjs';

export const publicationSentinel = 'NEXO_SYNTHETIC_SESSION_DO_NOT_PUBLISH_V1';

export function publicationPaths(scope) {
  if (requiredJobs.includes(scope)) return [`reports/ci/${scope}.json`];
  if (scope === 'gate') return requiredJobs.map((job) => `reports/ci/${job}.json`);
  if (scope === 'expanded') return ['reports/expanded/manifest.json'];
  throw new Error('Ámbito de publicación desconocido.');
}

// Los nombres son los archivos reales dentro del artefacto descargado. Nunca
// se admiten globs, directorios, rutas alternativas o adjuntos adicionales.
export function validatePublication(entries, scope) {
  const expected = publicationPaths(scope).map((path) => basename(path));
  if (
    !Array.isArray(entries) ||
    entries.length !== expected.length ||
    new Set(entries.map((entry) => entry?.name)).size !== expected.length ||
    entries.some((entry) => !expected.includes(entry?.name))
  )
    throw new Error('Conjunto de archivos publicables inesperado.');
  const parsed = new Map();
  for (const entry of entries) {
    let value;
    if (typeof entry.contents !== 'string') throw new Error('Contenido publicable ausente.');
    try {
      value = JSON.parse(entry.contents);
    } catch {
      throw new Error('Contenido publicable JSON inválido.');
    }
    if (
      entry.contents.includes(publicationSentinel) ||
      JSON.stringify(value).includes(publicationSentinel)
    )
      throw new Error('Un marcador reservado alcanzó el contenido publicable.');
    parsed.set(entry.name, value);
  }
  return parsed;
}

export async function preparePublication(scope, root = process.cwd()) {
  const paths = publicationPaths(scope);
  if (scope === 'gate') throw new Error('El agregado solo revisa archivos descargados.');
  const prohibited = join(
    root,
    'reports/raw/publication-control',
    scope,
    'storageState.synthetic.json',
  );
  await mkdir(dirname(prohibited), { recursive: true });
  await writeFile(
    prohibited,
    JSON.stringify({ cookies: [{ name: 'synthetic-session', value: publicationSentinel }] }) + '\n',
  );
  const fixture = await readFile(prohibited, 'utf8');
  if (!fixture.includes(publicationSentinel))
    throw new Error('El adjunto sintético no se preparó.');
  const entries = await Promise.all(
    paths.map(async (path) => ({
      name: basename(path),
      contents: await readFile(join(root, path), 'utf8'),
    })),
  );
  return validatePublication(entries, scope);
}
