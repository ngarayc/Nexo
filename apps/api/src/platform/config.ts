export interface ServerConfig {
  readonly host: '127.0.0.1' | '0.0.0.0';
  readonly port: number;
}

export function readServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const rawPort = env['PORT'] ?? '3000';
  if (!/^[1-9]\d{0,4}$/.test(rawPort)) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  const port = Number(rawPort);
  if (port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  const host = env['HOST'] ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') {
    throw new Error('HOST debe ser una dirección de escucha admitida.');
  }
  return { host, port };
}
