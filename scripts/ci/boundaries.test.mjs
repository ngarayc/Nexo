import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import config from '../../.dependency-cruiser.cjs';

function inspect(files) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-boundaries-'));
  try {
    writeFileSync(join(directory, 'rules.json'), JSON.stringify(config));
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), source);
    }
    const result = spawnSync(
      process.execPath,
      [
        resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        'apps',
        'packages',
        '--config',
        'rules.json',
        '--output-type',
        'json',
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.error, undefined);
    assert.ok([0, 10].includes(result.status));
    return { status: result.status, report: JSON.parse(result.stdout) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const minimal = {
  'apps/web/src/main.mjs': 'export const web = 1;',
  'packages/contracts/src/index.mjs': 'export const contract = 1;',
};

test('fronteras ignora solo salidas conocidas y caché, manteniendo fuentes no vacías', () => {
  const files = { ...minimal };
  for (const directory of [
    'apps/api/dist',
    'apps/web/dist',
    'packages/contracts/dist',
    'apps/web/.angular',
  ]) {
    files[directory + '/first.mjs'] = "import './second.mjs';";
    files[directory + '/second.mjs'] = "import './first.mjs';";
  }
  const result = inspect(files);
  assert.equal(result.status, 0);
  assert.equal(result.report.modules.length, 2);
});

test('fronteras sigue rechazando ciclos incluso en una carpeta dist dentro de src', () => {
  const result = inspect({
    ...minimal,
    'apps/web/src/dist/first.mjs': "import './second.mjs';",
    'apps/web/src/dist/second.mjs': "import './first.mjs';",
  });
  assert.ok(result.report.summary.violations.some((item) => item.rule.severity === 'error'));
  assert.ok(result.report.summary.violations.some((item) => item.rule.name === 'no-cycles'));
});

for (const [name, file, source, target] of [
  [
    'web-cannot-import-server',
    'apps/web/src/cross.mjs',
    "import '../../api/src/server.mjs';",
    'apps/api/src/server.mjs',
  ],
  [
    'server-cannot-import-web',
    'apps/api/src/cross.mjs',
    "import '../../web/src/main.mjs';",
    'apps/web/src/main.mjs',
  ],
  [
    'contracts-cannot-import-applications',
    'packages/contracts/src/cross.mjs',
    "import '../../../apps/web/src/main.mjs';",
    'apps/web/src/main.mjs',
  ],
  [
    'contracts-cannot-import-node',
    'packages/contracts/src/cross.mjs',
    "import 'node:fs';",
    undefined,
  ],
]) {
  test('fronteras conserva ' + name, () => {
    const files = { ...minimal, [file]: source };
    if (target && !files[target]) files[target] = 'export const target = 1;';
    const result = inspect(files);
    assert.ok(result.report.summary.violations.some((item) => item.rule.severity === 'error'));
    assert.ok(result.report.summary.violations.some((item) => item.rule.name === name));
  });
}
