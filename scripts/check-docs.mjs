import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path);
    }
  }
  return files;
}

const files = [
  resolve('README.md'),
  resolve('AGENTS.md'),
  resolve('AGENT-GOVERNANCE.md'),
  resolve('AGENT-EFFICIENCY.md'),
  ...(await markdownFiles('docs')),
  ...(await markdownFiles('skills')),
];
const failures = [];
let checked = 0;
for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const destination = decodeURIComponent(target.split('#')[0]);
    checked += 1;
    if (!existsSync(resolve(dirname(file), destination))) failures.push({ file, target });
  }
}
if (failures.length > 0) {
  console.error('Enlaces internos inexistentes:', failures);
  process.exitCode = 1;
} else {
  console.log(`Documentación: ${checked} enlaces internos válidos.`);
}
