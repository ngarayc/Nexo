import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

// Huella del material realmente ejecutable, no de una versión nominal o SHA
// inyectado sin comprobar. No lee configuración local, secretos ni planes.
export async function loadReplaySoftwareFingerprint(): Promise<string> {
  const root = new URL('../../../../../../../', import.meta.url),
    hash = createHash('sha256');
  const add = async (path: string) => {
    const bytes = await readFile(new URL(path, root));
    hash.update(JSON.stringify([path, bytes.length]) + '\n').update(bytes);
  };
  const walk = async (path: string): Promise<number> => {
    const entries = (await readdir(new URL(path, root), { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    let count = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Material inesperado.');
      if (entry.isDirectory()) count += await walk(path + entry.name + '/');
      else if (entry.isFile() && /\.(?:js|json|sql)$/.test(entry.name)) {
        await add(path + entry.name);
        count++;
      }
    }
    return count;
  };
  try {
    hash.update('nexo-replay-software-v1\n' + process.version + '\n');
    for (const directory of [
      'apps/api/dist/',
      'packages/contracts/dist/',
      'apps/api/migrations/',
    ]) {
      if ((await walk(directory)) === 0) throw new Error('Material vacío.');
    }
    await add('package-lock.json');
    return hash.digest('hex');
  } catch {
    throw new Error('No se pudo identificar el código de la reproducción.');
  }
}
