import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapConfiguration } from '../map-provider.mjs';

const provider = JSON.parse(readFileSync('infra/map-provider.json', 'utf8'));
const template = readFileSync('infra/nginx.conf', 'utf8');
const configuration = (changes = {}) => mapConfiguration({ ...provider, ...changes }, template);

test('proveedor y todas las políticas derivan del mismo JSON sin ampliar otras directivas', () => {
  const result = configuration();
  assert.deepEqual(result.provider, provider);
  assert.equal(Object.isFrozen(result.provider), true);
  assert.equal(result.nginx.replaceAll(' ' + provider.allowedOrigin, ''), template);
  assert.equal(
    result.nginx.split(`img-src 'self' data: ${provider.allowedOrigin};`).length - 1,
    template.match(/Content-Security-Policy /gu).length,
  );
});

test('proveedor rechaza origen comodín, credenciales, URI ambigua e inyección de política', () => {
  for (const origin of [
    'https://*.example.com',
    'https://user:password@example.com',
    'http://example.com',
    "https://example.com'; script-src *",
    'https://example.com\r\nX-Test: value',
    'https://tile.openstreetmap.org/',
    'https://tile.openstreetmap.org:443',
  ]) {
    assert.throws(() => configuration({ allowedOrigin: origin }));
  }
});

test('plantilla de tiles mantiene origen y tres coordenadas explícitas sin secretos en query', () => {
  for (const tileUrl of [
    provider.tileUrl + '?key=value',
    provider.tileUrl + '#fragment',
    provider.tileUrl.replace('{z}', '{zoom}'),
    provider.tileUrl.replace('{y}', '{x}'),
    provider.tileUrl.replace('tile.openstreetmap.org', 'other.example.com'),
    provider.tileUrl.replace('https:', 'javascript:'),
    ' ' + provider.tileUrl,
  ]) {
    assert.throws(() => configuration({ tileUrl }));
  }
});

test('configuración cartográfica rechaza esquema incompleto y enlaces ejecutables', () => {
  for (const input of [
    null,
    [],
    {},
    { ...provider, extra: true },
    { ...provider, maxZoom: 1.5 },
    { ...provider, maxZoom: Infinity },
    { ...provider, maxZoom: 0 },
    { ...provider, attribution: '' },
    { ...provider, attributionUrl: 'javascript:alert(1)' },
  ]) {
    assert.throws(() => mapConfiguration(input, template));
  }
});

test('generador falla si no puede cubrir cada respuesta CSP o si se intenta renderizar dos veces', () => {
  for (const value of [
    '',
    template.replace("img-src 'self' data:;", 'img-src *;'),
    configuration().nginx,
  ])
    assert.throws(() => mapConfiguration(provider, value));
});

test('CLI genera solo proveedor público y nginx coherente usando el validador compartido', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexo-map-config-'));
  try {
    execFileSync(process.execPath, ['scripts/map-provider.mjs', directory], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(directory).sort(), ['map-provider.json', 'nginx.conf']);
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, 'map-provider.json'), 'utf8')),
      provider,
    );
    assert.equal(readFileSync(join(directory, 'nginx.conf'), 'utf8'), configuration().nginx);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
