import { createHash } from 'node:crypto';

// Perfil efectivo permitido: nunca recibe process.env ni serializa credenciales.
export interface ReplayConfiguration {
  readonly database: { readonly host: string; readonly port: number; readonly database: string };
  readonly publicOrigin: string;
  readonly demoEnabled: boolean;
  readonly ingestionLimits: { readonly bodyBytes: number; readonly events: number };
  readonly server: { readonly host: string; readonly port: number };
}
export function replayConfigurationFingerprint(config: ReplayConfiguration): string {
  const value = {
    database: {
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
    },
    publicOrigin: config.publicOrigin,
    demoEnabled: config.demoEnabled,
    ingestionLimits: {
      bodyBytes: config.ingestionLimits.bodyBytes,
      events: config.ingestionLimits.events,
    },
    server: { host: config.server.host, port: config.server.port },
  };
  if (
    !/^[a-zA-Z0-9.-]{1,253}$/.test(value.database.host) ||
    value.database.port !== 5432 ||
    value.database.database !== 'nexo' ||
    !/^http:\/\/localhost:(8080|8081)$/.test(value.publicOrigin) ||
    typeof value.demoEnabled !== 'boolean' ||
    !['127.0.0.1', '0.0.0.0'].includes(value.server.host) ||
    !Number.isInteger(value.server.port) ||
    value.server.port < 1 ||
    value.server.port > 65535 ||
    !Number.isSafeInteger(value.ingestionLimits.bodyBytes) ||
    value.ingestionLimits.bodyBytes < 1 ||
    !Number.isSafeInteger(value.ingestionLimits.events) ||
    value.ingestionLimits.events < 1
  )
    throw new Error('No se pudo identificar la configuración de la reproducción.');
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
