// El origen es configuración del operador, nunca una cabecera de la petición.
export function isCanonicalPublicOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^http:\/\/localhost:(8080|8081)$/.test(value)) return true;
  if (value.length > 280) return false;
  const match = /^https:\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/.exec(value);
  if (!match) return false;
  const hostname = match[1]!;
  const port = match[2];
  return (
    hostname.length <= 253 &&
    hostname.includes('.') &&
    !/^[\d.]+$/.test(hostname) &&
    hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    (port === undefined || (port !== '443' && Number(port) <= 65535))
  );
}
