import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMapProvider } from '../apps/web/src/app/platform/maps/map-provider-config.ts';

export function mapConfiguration(input, template) {
  const provider = readMapProvider(input);
  const directive = "img-src 'self' data:;";
  const policies = template.match(/Content-Security-Policy /gu)?.length ?? 0;
  if (policies === 0 || template.split(directive).length - 1 !== policies)
    throw new Error('No se pudo comprobar la política cartográfica.');
  return {
    provider,
    nginx: template.replaceAll(directive, `img-src 'self' data: ${provider.allowedOrigin};`),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = mapConfiguration(
    JSON.parse(await readFile(new URL('../infra/map-provider.json', import.meta.url), 'utf8')),
    await readFile(new URL('../infra/nginx.conf', import.meta.url), 'utf8'),
  );
  if (process.argv[2] === '--prepare-assets') {
    const directory = fileURLToPath(new URL('../apps/web/public/', import.meta.url));
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, 'map-provider.json'),
      JSON.stringify(result.provider, null, 2) + '\n',
    );
  } else if (process.argv[2] !== '--check') {
    if (!process.argv[2] || process.argv.length !== 3)
      throw new Error('Falta el directorio de salida.');
    const directory = resolve(process.argv[2]);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'nginx.conf'), result.nginx);
    await writeFile(
      resolve(directory, 'map-provider.json'),
      JSON.stringify(result.provider) + '\n',
    );
  }
  console.log('Configuración cartográfica y políticas coherentes.');
}
