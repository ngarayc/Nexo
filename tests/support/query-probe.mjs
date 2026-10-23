import { readFileSync } from 'node:fs';

// El mismo módulo probado se entrega al cliente Node del contenedor como ESM;
// no se incorpora instrumentación de pruebas a la imagen de aplicación.
export function queryProbeSource() {
  const observations = readFileSync(new URL('volume-observations.mjs', import.meta.url));
  const probe = readFileSync(new URL('check-queries.mjs', import.meta.url), 'utf8');
  const reference = "from './volume-observations.mjs'";
  if (probe.split(reference).length !== 2)
    throw new Error('Dependencia del probe no identificada.');
  return probe.replace(
    reference,
    "from 'data:text/javascript;base64," + observations.toString('base64') + "'",
  );
}
