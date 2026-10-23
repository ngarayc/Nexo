import { describe, expect, it } from 'vitest';
import { readAccessConfig } from './access-config.js';

const environment = (origin: string) => ({
  PUBLIC_ORIGIN: origin,
  SESSION_SECRET: 'a'.repeat(64),
  DEMO_ENABLED: 'true',
});

describe('origen canónico de acceso local y HTTPS', () => {
  it('HTTPS reduce la cuota global de login a cinco intentos por minuto', () => {
    const config = readAccessConfig(environment('https://nexo.example.com'));
    expect(config.loginLimit).toBe(5);
    expect(config.windowMilliseconds).toBe(60000);
  });
  it.each([
    'http://localhost:8080',
    'http://localhost:8081',
    'https://nexo.example.com',
    'https://nexo.example.com:8443',
  ])('acepta el perfil explícito %s', (origin) => {
    expect(readAccessConfig(environment(origin)).origin).toBe(origin);
  });

  it.each([
    '',
    'http://nexo.example.com',
    'http://localhost:3000',
    'https://localhost',
    'https://127.0.0.1',
    'https://nexo.example.com/',
    'https://nexo.example.com/path',
    'https://nexo.example.com?query=1',
    'https://nexo.example.com#fragment',
    'https://user:password@nexo.example.com',
    'https://nexo.example.com:443',
    'https://NEXO.example.com',
    'https://-nexo.example.com',
    'https://nexo..example.com',
    'null',
  ])('rechaza origen ambiguo, inseguro o no canónico %s', (origin) => {
    expect(() => readAccessConfig(environment(origin))).toThrow('PUBLIC_ORIGIN');
  });
});
