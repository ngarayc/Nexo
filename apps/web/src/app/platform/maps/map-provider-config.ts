export type MapProvider = Readonly<{
  tileUrl: string;
  allowedOrigin: string;
  attribution: string;
  attributionUrl: string;
  maxZoom: number;
}>;

function invalid(): never {
  throw new Error('Configuración cartográfica inválida.');
}

function https(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.href !== value)
    return invalid();
  return url;
}

// Una sola validación para el build y el cliente; solo usa APIs web estándar.
export function readMapProvider(input: unknown): MapProvider {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const keys = ['tileUrl', 'allowedOrigin', 'attribution', 'attributionUrl', 'maxZoom'];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  if (
    typeof value.tileUrl !== 'string' ||
    value.tileUrl.length > 2048 ||
    typeof value.allowedOrigin !== 'string' ||
    typeof value.attribution !== 'string' ||
    value.attribution.length === 0 ||
    value.attribution.length > 300 ||
    typeof value.attributionUrl !== 'string' ||
    value.attributionUrl.length > 2048 ||
    typeof value.maxZoom !== 'number' ||
    !Number.isInteger(value.maxZoom) ||
    value.maxZoom < 1 ||
    value.maxZoom > 20
  )
    return invalid();
  const origin = https(value.allowedOrigin + '/');
  if (
    origin.origin !== value.allowedOrigin ||
    !/^[a-z0-9.-]+$/u.test(origin.hostname) ||
    origin.port !== '' ||
    !value.tileUrl.startsWith(value.allowedOrigin + '/')
  )
    return invalid();
  let expanded = value.tileUrl;
  for (const token of ['{z}', '{x}', '{y}']) {
    if (expanded.split(token).length !== 2) return invalid();
    expanded = expanded.replace(token, '0');
  }
  if (/[{}]/u.test(expanded)) return invalid();
  const tile = https(expanded);
  if (tile.origin !== origin.origin || tile.search || tile.hash) return invalid();
  https(value.attributionUrl);
  return Object.freeze({
    tileUrl: value.tileUrl,
    allowedOrigin: value.allowedOrigin,
    attribution: value.attribution,
    attributionUrl: value.attributionUrl,
    maxZoom: value.maxZoom,
  });
}
