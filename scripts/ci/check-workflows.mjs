import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateWorkflows } from './workflow-policy.mjs';

const files = [
  '.github/workflows/ci.yml',
  '.github/workflows/main-review.yml',
  '.github/actions/setup-project/action.yml',
];
validateWorkflows(
  ...(await Promise.all(files.map(async (file) => parse(await readFile(file, 'utf8'))))),
);
console.log(
  'Workflows: controles obligatorios, revisión separada, pins y lista de artefactos válidos.',
);
