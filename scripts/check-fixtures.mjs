import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(
  await readFile(new URL('../fixtures/sha256.json', import.meta.url), 'utf8'),
);
for (const [name, expected] of Object.entries(manifest)) {
  const contents = await readFile(new URL(`../fixtures/${name}`, import.meta.url));
  const actual = createHash('sha256').update(contents).digest('hex');
  if (actual !== expected) throw new Error(`Fixture alterado: ${name}`);
}
console.log(`Fixtures conservados: ${Object.keys(manifest).length}.`);
