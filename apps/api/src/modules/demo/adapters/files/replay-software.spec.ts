import { beforeEach, describe, expect, it, vi } from 'vitest';
const files = vi.hoisted(() => new Map<string, string>());
const context = vi.hoisted(() => ({ root: '' }));
vi.mock('node:fs/promises', () => ({
  readFile: async (url: URL) => {
    const path = url.href.slice(context.root.length),
      value = files.get(path);
    if (value === undefined) throw new Error('synthetic-private-marker');
    return Buffer.from(value);
  },
  readdir: async (url: URL) => {
    const path = url.href.slice(context.root.length);
    return [...files.keys()]
      .filter((key) => key.startsWith(path) && !key.slice(path.length).includes('/'))
      .reverse()
      .map((key) => ({
        name: key.slice(path.length),
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      }));
  },
}));
import { loadReplaySoftwareFingerprint } from './replay-software.js';
beforeEach(() => {
  context.root = new URL('../../../../../../../', import.meta.url).href;
  files.clear();
  for (const [path, value] of [
    ['apps/api/dist/main.js', 'executed backend'],
    ['packages/contracts/dist/index.js', 'contracts'],
    ['apps/api/migrations/0000.sql', 'schema'],
    ['package-lock.json', 'locked dependencies'],
  ])
    files.set(path!, value!);
});
describe('identificación del material ejecutable, independiente de versión nominal', () => {
  it('el mismo material produce una huella estable; cambiar código sin cambiar nombre la modifica', async () => {
    const first = await loadReplaySoftwareFingerprint();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadReplaySoftwareFingerprint()).toBe(first);
    files.set('apps/api/dist/main.js', 'changed backend');
    expect(await loadReplaySoftwareFingerprint()).not.toBe(first);
  });
  it('cambios en migración o dependencias también cambian el contexto', async () => {
    const first = await loadReplaySoftwareFingerprint();
    files.set('package-lock.json', 'other dependencies');
    expect(await loadReplaySoftwareFingerprint()).not.toBe(first);
    files.set('package-lock.json', 'locked dependencies');
    files.set('apps/api/migrations/0000.sql', 'other schema');
    expect(await loadReplaySoftwareFingerprint()).not.toBe(first);
  });
  it('un paquete ausente deja contexto desconocido y no expone el error original', async () => {
    files.delete('package-lock.json');
    await expect(loadReplaySoftwareFingerprint()).rejects.toThrow(
      'No se pudo identificar el código',
    );
    files.clear();
    await expect(loadReplaySoftwareFingerprint()).rejects.toThrow(
      'No se pudo identificar el código',
    );
  });
});
