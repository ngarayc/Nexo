import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('Este instalador de CI requiere Linux x64.');
}
const versions = JSON.parse(await readFile(new URL('./tools.json', import.meta.url), 'utf8'));
await mkdir('.cache/tools', { recursive: true, mode: 0o700 });
for (const [name, source] of Object.entries(versions)) {
  const temporary = resolve('.cache/tools', `${name}-${randomBytes(8).toString('hex')}`);
  const target = resolve('.cache/tools', `${name}-${source.version}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('No fue posible descargar la herramienta fijada.');
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== source.sha256) {
      throw new Error('Checksum incorrecto: herramienta rechazada.');
    }
    const tarball = resolve(temporary, 'tool.tar.gz');
    await writeFile(tarball, archive, { mode: 0o600 });
    execFileSync('tar', ['-xzf', tarball, '-C', temporary, name], { stdio: 'pipe' });
    await rm(tarball);
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
    console.log(
      `${name} ${source.version}: archivo verificado e instalado en la caché del proyecto.`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
