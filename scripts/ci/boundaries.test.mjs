import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import config from '../../.dependency-cruiser.cjs';

const command = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).scripts.boundaries.split(/\s+/u);
assert.equal(command[0], 'depcruise');

function inspect(files) {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-boundaries-'));
  try {
    writeFileSync(
      join(directory, '.dependency-cruiser.cjs'),
      'module.exports = ' + JSON.stringify(config),
    );
    for (const root of ['apps/api/src', 'apps/web/src', 'packages/contracts/src'])
      mkdirSync(join(directory, root), { recursive: true });
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), source);
    }
    const result = spawnSync(
      process.execPath,
      [
        resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        ...command.slice(1),
        '--output-type',
        'json',
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.error, undefined);
    assert.ok([0, 10].includes(result.status));
    // El reporter JSON puede devolver0 aun con violaciones. Comprobar también
    // el comando con el reporter efectivo de npm run boundaries/CI.
    const blocking = spawnSync(
      process.execPath,
      [resolve('node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'), ...command.slice(1)],
      { cwd: directory, encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(blocking.error, undefined);
    assert.ok(Number.isInteger(blocking.status) && blocking.status >= 0);
    return {
      status: result.status,
      blockingStatus: blocking.status,
      report: JSON.parse(result.stdout),
    };
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
    'web-cannot-import-server',
    'apps/web/src/cross.mjs',
    "import '../../api/dist/server.mjs';",
    'apps/api/dist/server.mjs',
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
  [
    'backend-core-cannot-import-adapters',
    'apps/api/src/modules/ingestion/domain/work.mjs',
    "import '../adapters/storage.mjs';",
    'apps/api/src/modules/ingestion/adapters/storage.mjs',
  ],
  [
    'domain-cannot-import-application',
    'apps/api/src/modules/ingestion/domain/work.mjs',
    "import '../application/process.mjs';",
    'apps/api/src/modules/ingestion/application/process.mjs',
  ],
  [
    'domain-cannot-import-node',
    'apps/api/src/modules/ingestion/domain/work.mjs',
    "import 'node:fs';",
    undefined,
  ],
  [
    'backend-core-cannot-import-adapters',
    'apps/api/src/modules/ingestion/application/process.mjs',
    "import '../adapters/storage.mjs';",
    'apps/api/src/modules/ingestion/adapters/storage.mjs',
  ],
  ...['access', 'demo', 'ingestion', 'queries', 'realtime', 'telemetry'].map((name) => [
    `${name}-only-through-public-entry`,
    `apps/api/src/modules/${name === 'queries' ? 'demo' : 'queries'}/application/cross.mjs`,
    `import '../../${name}/adapters/storage.mjs';`,
    `apps/api/src/modules/${name}/adapters/storage.mjs`,
  ]),
  [
    'web-platform-cannot-import-features',
    'apps/web/src/app/platform/layout.mjs',
    "import '../features/fleet/fleet-facade.mjs';",
    'apps/web/src/app/features/fleet/fleet-facade.mjs',
  ],
  [
    'fleet-feature-public-surface',
    'apps/web/src/app/features/alerts/alerts-facade.mjs',
    "import '../fleet/adapters/leaflet-fleet-map.mjs';",
    'apps/web/src/app/features/fleet/adapters/leaflet-fleet-map.mjs',
  ],
  [
    'facades-cannot-import-presentation',
    'apps/web/src/app/features/fleet/fleet-facade.mjs',
    "import './fleet-map.mjs';",
    'apps/web/src/app/features/fleet/fleet-map.mjs',
  ],
  [
    'web-transports-cannot-import-features',
    'apps/web/src/app/features/access/data-access/session-api.mjs',
    "import '../../fleet/fleet-facade.mjs';",
    'apps/web/src/app/features/fleet/fleet-facade.mjs',
  ],
  [
    'presentation-cannot-import-transport-or-facades',
    'apps/web/src/app/features/fleet/fleet-table.mjs',
    "import './fleet-facade.mjs';",
    'apps/web/src/app/features/fleet/fleet-facade.mjs',
  ],
]) {
  test(
    'fronteras conserva ' + name + (target?.includes('/dist/') ? ' hacia salida compilada' : ''),
    () => {
      const files = { ...minimal, [file]: source };
      if (target && !files[target]) files[target] = 'export const target = 1;';
      const result = inspect(files);
      assert.notEqual(result.blockingStatus, 0);
      assert.ok(result.report.modules.length >= 2);
      const sourceModule = result.report.modules.find((item) => item.source === file);
      assert.ok(sourceModule?.dependencies.length > 0, 'La arista debe estar analizada.');
      assert.ok(result.report.summary.violations.some((item) => item.rule.severity === 'error'));
      assert.ok(result.report.summary.violations.some((item) => item.rule.name === name));
    },
  );
}

test('las entradas públicas, dominio propio y fachadas colaboradoras siguen permitidas', () => {
  const result = inspect({
    ...minimal,
    'apps/api/src/modules/queries/application/read.mjs': "import '../../telemetry/public.mjs';",
    'apps/api/src/modules/telemetry/public.mjs': "export * from './domain/value.mjs';",
    'apps/api/src/modules/telemetry/domain/value.mjs': "import './other.mjs';",
    'apps/api/src/modules/telemetry/domain/other.mjs': 'export const value = 1;',
    'apps/web/src/app/features/alerts/alerts-facade.mjs': "import '../fleet/fleet-facade.mjs';",
    'apps/web/src/app/features/fleet/fleet-facade.mjs': 'export const view = 1;',
    'apps/web/src/app/shell/app-shell.mjs': "import '../features/fleet/fleet-facade.mjs';",
  });
  assert.equal(result.status, 0);
  assert.equal(result.blockingStatus, 0);
  assert.equal(result.report.summary.violations.length, 0);
  assert.ok(result.report.modules.length >= 9);
});

for (const [library, source, rule] of [
  [
    '@nestjs/common',
    'apps/api/src/modules/demo/domain/value.mjs',
    'backend-core-cannot-import-framework-or-database',
  ],
  [
    'pg',
    'apps/api/src/modules/queries/application/read.mjs',
    'backend-core-cannot-import-framework-or-database',
  ],
  [
    'leaflet',
    'apps/web/src/app/features/fleet/fleet-facade.mjs',
    'facades-cannot-import-presentation',
  ],
  [
    'chart.js',
    'apps/web/src/app/features/fleet/fleet-facade.mjs',
    'facades-cannot-import-presentation',
  ],
  [
    '@angular/common/http',
    'apps/web/src/app/features/fleet/fleet-table.mjs',
    'presentation-cannot-import-transport-or-facades',
  ],
]) {
  test('fronteras bloquea dependencia externa ' + library + ' desde ' + source, () => {
    const result = inspect({
      ...minimal,
      [source]: `import '${library}';`,
      [`node_modules/${library}/package.json`]: JSON.stringify({ main: 'index.js' }),
      [`node_modules/${library}/index.js`]: 'export const external = 1;',
    });
    assert.notEqual(result.blockingStatus, 0);
    assert.ok(result.report.modules.find((item) => item.source === source)?.dependencies.length);
    assert.ok(result.report.summary.violations.some((item) => item.rule.name === rule));
  });
}
