import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mapConfiguration } from './map-provider.mjs';

// Reutiliza la política cartográfica y CSP de la imagen local. Este archivo solo
// se monta en web sin puertos publicados, detrás del terminador TLS.
const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error('Falta el directorio del proxy.');
const result = mapConfiguration(
  JSON.parse(await readFile(new URL('../infra/map-provider.json', import.meta.url), 'utf8')),
  await readFile(new URL('../infra/nginx.conf', import.meta.url), 'utf8'),
);
const source = 'proxy_set_header X-Forwarded-Proto "";';
if (result.nginx.split(source).length !== 3)
  throw new Error('No se pudo comprobar el saneamiento del proxy HTTPS.');
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, 'nginx.azure.conf'),
  result.nginx.replaceAll(source, 'proxy_set_header X-Forwarded-Proto https;'),
  { mode: 0o644 },
);
console.log('Proxy HTTPS generado con la política CSP cartográfica.');
