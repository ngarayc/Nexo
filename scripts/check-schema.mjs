import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

async function fingerprint(directory) {
  const hash = createHash('sha256');
  for (const name of (await readdir(directory, { recursive: true })).sort()) {
    const path = join(directory, name);
    if (!(await stat(path)).isFile()) continue;
    hash
      .update(name)
      .update('\0')
      .update(await readFile(path));
  }
  return hash.digest('hex');
}

const migrations = resolve('apps/api/migrations');
const before = await fingerprint(migrations);
const temporary = await mkdtemp(join(tmpdir(), 'nexo-schema-check-'));
try {
  await cp(migrations, temporary, { recursive: true });
  const output = execFileSync(
    process.execPath,
    [
      resolve('node_modules/drizzle-kit/bin.cjs'),
      'generate',
      '--dialect',
      'postgresql',
      '--schema',
      './src/platform/database/schema.ts',
      '--out',
      relative(resolve('apps/api'), temporary),
    ],
    {
      cwd: resolve('apps/api'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    },
  );
  // Algunas versiones del CLI retornan cero incluso tras un error interno.
  if (
    !output.includes('No schema changes, nothing to migrate') ||
    (await fingerprint(temporary)) !== before ||
    (await fingerprint(migrations)) !== before
  ) {
    throw new Error('El esquema y sus migraciones no coinciden o el generador quedó inconcluso.');
  }
  console.log('Esquema ORM y snapshots coherentes; SQL manual conservado, sin archivos nuevos.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
