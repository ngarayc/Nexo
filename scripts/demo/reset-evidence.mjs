import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ResetError } from './reset-policy.mjs';

export const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
export function privateFile(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new ResetError('PRIVATE_FILE_REQUIRED');
  return realpathSync(path);
}
export function evidenceRoot(path, repository) {
  const root = resolve(path),
    inside = relative(join(repository, 'reports'), root);
  // Archivos fuera de Docker y dentro de la carpeta ignorada de reportes.
  if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside))
    throw new ResetError('EVIDENCE_OUTSIDE_REPORTS');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (realpathSync(root) !== root) throw new ResetError('EVIDENCE_SYMLINK');
  const stat = lstatSync(root);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    throw new ResetError('PRIVATE_DIRECTORY_REQUIRED');
  return root;
}
export function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function saveManifest(directory, manifest) {
  const path = join(directory, `manifest-${randomUUID()}.tmp`),
    fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(manifest) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(path, join(directory, 'manifest.json'));
  syncDirectory(directory);
}
export function readManifest(directory) {
  try {
    privateFile(join(directory, 'manifest.json'));
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    if (
      manifest.version !== 1 ||
      typeof manifest.id !== 'string' ||
      !Array.isArray(manifest.archives) ||
      !manifest.oldVolume ||
      !manifest.images ||
      ![
        'created',
        'archived',
        'stopped',
        'removing',
        'removed',
        'recreating',
        'verifying',
        'complete',
      ].includes(manifest.phase)
    )
      throw 0;
    return manifest;
  } catch {
    throw new ResetError('INVALID_RESUME');
  }
}
export function acquireLock(repository, project, engine, operation, resume) {
  const root = evidenceRoot(join(repository, 'reports', 'demo-reset-locks'), repository);
  const file = join(root, `${project}-${engine}.json`);
  if (existsSync(file)) {
    let previous;
    try {
      privateFile(file);
      previous = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new ResetError('RESET_LOCKED');
    }
    if (
      !resume ||
      previous.operation !== operation ||
      !Number.isSafeInteger(previous.pid) ||
      previous.pid <= 0
    )
      throw new ResetError('RESET_LOCKED');
    try {
      process.kill(previous.pid, 0);
      throw new ResetError('RESET_LOCKED');
    } catch (error) {
      if (error.code !== 'ESRCH') throw new ResetError('RESET_LOCKED');
    }
    unlinkSync(file);
  }
  let fd;
  try {
    fd = openSync(file, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, operation }));
    fsyncSync(fd);
  } catch {
    throw new ResetError('RESET_LOCKED');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return () => {
    unlinkSync(file);
    syncDirectory(root);
  };
}
export function exportEvidence(adapter, directory) {
  const name = `snapshot-${randomUUID()}.jsonl`,
    path = join(directory, name),
    fd = openSync(path, 'wx', 0o600);
  try {
    adapter.archive(fd);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const info = verifyArchive(directory, { name });
  syncDirectory(directory);
  return info;
}
export function verifyArchive(directory, expected) {
  if (!/^snapshot-[a-f0-9-]{36}\.jsonl$/.test(expected.name))
    throw new ResetError('INVALID_EVIDENCE');
  const path = join(directory, expected.name);
  privateFile(path);
  const raw = readFileSync(path),
    sha256 = fingerprint(raw);
  if (raw.length > 64 * 1024 * 1024 || (expected.sha256 && expected.sha256 !== sha256))
    throw new ResetError('INVALID_EVIDENCE');
  let rows;
  try {
    rows = raw
      .toString('utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    throw new ResetError('INVALID_EVIDENCE');
  }
  if (
    rows[0]?.kind !== 'snapshot' ||
    rows.at(-1)?.kind !== 'complete' ||
    rows.at(-1)?.data?.complete !== true ||
    rows.slice(1, -1).some((row) => !['run', 'attempt', 'receipt'].includes(row.kind))
  )
    throw new ResetError('INCOMPLETE_EVIDENCE');
  const counts = rows[0].data?.counts;
  if (
    !counts ||
    Object.keys(counts).length !== 8 ||
    Object.values(counts).some((v) => typeof v !== 'string' || !/^\d+$/.test(v))
  )
    throw new ResetError('INVALID_EVIDENCE');
  for (const [kind, table] of [
    ['run', 'replay_runs'],
    ['attempt', 'replay_attempts'],
    ['receipt', 'ingestion_batches'],
  ])
    if (BigInt(counts[table]) !== BigInt(rows.filter((row) => row.kind === kind).length))
      throw new ResetError('INCOMPLETE_EVIDENCE');
  return {
    name: expected.name,
    sha256,
    bytes: raw.length,
    counts,
    accountReady: rows[0].data.accountReady,
    migrationHash: rows[0].data.migrationHash,
  };
}
export function newOperation(root, project) {
  const id = randomUUID(),
    directory = join(root, `${project}-${id}`);
  mkdirSync(directory, { mode: 0o700 });
  syncDirectory(root);
  return { id, directory };
}
export function resumeDirectory(path, repository) {
  const directory = evidenceRoot(resolve(path), repository);
  if (dirname(directory) === directory) throw new ResetError('INVALID_RESUME');
  return directory;
}
