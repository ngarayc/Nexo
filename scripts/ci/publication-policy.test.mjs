import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  publicationPaths,
  publicationSentinel,
  validatePublication,
  preparePublication,
} from './publication-policy.mjs';

const entry = (name = 'quality.json', contents = '{}') => ({ name, contents });

test('listas de publicación conservan cinco informes ordinarios y un manifiesto separado', () => {
  assert.deepEqual(publicationPaths('gate'), [
    'reports/ci/quality.json',
    'reports/ci/unit.json',
    'reports/ci/integration.json',
    'reports/ci/security-source.json',
    'reports/ci/system.json',
  ]);
  assert.deepEqual(publicationPaths('expanded'), ['reports/expanded/manifest.json']);
  for (const scope of ['main', '../quality', 'reports/**', '', undefined])
    assert.throws(() => publicationPaths(scope));
  assert.equal(validatePublication([entry('manifest.json')], 'expanded').size, 1);
});

test('rechaza adjuntos, rutas alternativas, archivos ausentes y nombres duplicados', () => {
  for (const entries of [
    [],
    [entry(), entry('storageState.synthetic.json')],
    [entry('trace.zip')],
    [entry('../quality.json')],
    [entry('reports/ci/quality.json')],
    [entry('reports/**')],
    [entry(), entry()],
  ])
    assert.throws(() => validatePublication(entries, 'quality'));
  const gate = publicationPaths('gate').map((path) => entry(path.split('/').at(-1)));
  assert.equal(validatePublication(gate, 'gate').size, 5);
  assert.throws(() => validatePublication([...gate, entry('trace.zip')], 'gate'));
});

test('un marcador literal o escapado en JSON bloquea sin propagarse en el diagnóstico', () => {
  const raw = JSON.stringify({ cookie: publicationSentinel });
  const escaped = raw.replace('NEXO', '\\u004eEXO');
  assert.equal(escaped.includes(publicationSentinel), false);
  for (const contents of [raw, escaped, '{' + publicationSentinel]) {
    let caught;
    try {
      validatePublication([entry('quality.json', contents)], 'quality');
    } catch (error) {
      caught = error;
    }
    assert.ok(caught);
    assert.equal(caught.message.includes(publicationSentinel), false);
  }
  assert.throws(() => validatePublication([entry('manifest.json', escaped)], 'expanded'));
  const downloaded = publicationPaths('gate').map((path) => entry(path.split('/').at(-1)));
  downloaded[1] = entry('unit.json', escaped);
  assert.throws(() => validatePublication(downloaded, 'gate'));
});

test('sembrar un adjunto prohibido en disco conserva solo el archivo permitido seleccionado', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nexo-publication-'));
  try {
    await mkdir(join(root, 'reports/ci'), { recursive: true });
    await writeFile(join(root, 'reports/ci/quality.json'), '{"check":"synthetic"}\n');
    const parsed = await preparePublication('quality', root);
    assert.deepEqual([...parsed.keys()], ['quality.json']);
    assert.deepEqual(parsed.get('quality.json'), { check: 'synthetic' });
    const excluded = await readFile(
      join(root, 'reports/raw/publication-control/quality/storageState.synthetic.json'),
      'utf8',
    );
    assert.ok(excluded.includes(publicationSentinel));
    assert.throws(() =>
      validatePublication([entry(), entry('storageState.synthetic.json', excluded)], 'quality'),
    );
    await writeFile(
      join(root, 'reports/ci/quality.json'),
      JSON.stringify({ cookie: publicationSentinel }),
    );
    await assert.rejects(preparePublication('quality', root));
    await assert.rejects(preparePublication('unit', root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('la CLI rechaza un checkout diferente antes de preparar publicación y no imprime datos crudos', () => {
  const result = spawnSync(process.execPath, ['scripts/ci/check-publication.mjs', 'quality'], {
    env: { ...process.env, GITHUB_SHA: '0'.repeat(40) },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr.trim(),
    'Publicación rechazada; revisar el control y su diagnóstico privado.',
  );
});
