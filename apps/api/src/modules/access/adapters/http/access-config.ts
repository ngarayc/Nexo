import { isCanonicalPublicOrigin } from '@nexo/contracts';

export interface AccessConfig {
  readonly origin: string;
  readonly secret: string;
  readonly demoEnabled: boolean;
  readonly sessionMilliseconds: number;
  readonly maximumSessions: number;
  readonly loginLimit: number;
  readonly readLimit: number;
  readonly windowMilliseconds: number;
}

export function readAccessConfig(env: NodeJS.ProcessEnv): AccessConfig {
  const origin = env['PUBLIC_ORIGIN'];
  if (!isCanonicalPublicOrigin(origin)) {
    throw new Error('PUBLIC_ORIGIN debe identificar un origen canónico local o HTTPS.');
  }
  const secret = env['SESSION_SECRET'];
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('SESSION_SECRET inválido.');
  if (!['true', 'false'].includes(env['DEMO_ENABLED'] ?? ''))
    throw new Error('DEMO_ENABLED inválido.');
  return {
    origin,
    secret,
    demoEnabled: env['DEMO_ENABLED'] === 'true',
    sessionMilliseconds: 4 * 60 * 60 * 1000,
    maximumSessions: 32,
    loginLimit: origin.startsWith('https://') ? 5 : 10,
    readLimit: 600,
    windowMilliseconds: 60000,
  };
}

export const ACCESS_CONFIG = Symbol('access-config');
