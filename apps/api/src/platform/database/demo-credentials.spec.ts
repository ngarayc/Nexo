import { describe, expect, it } from 'vitest';
import { readDemoCredentials } from './demo-credentials.js';

describe('credenciales privadas de la demostración', () => {
  it('conserva compatibilidad local y exige configuración para HTTPS', () => {
    expect(readDemoCredentials({}).username).toBe('demo');
    expect(() => readDemoCredentials({ PUBLIC_ORIGIN: 'https://nexo.example.com' })).toThrow();
  });
  it('admite la cuenta explícita y una contraseña privada sin normalizarla', () => {
    const password = 'Synthetic-Test-9384!';
    expect(readDemoCredentials({ DEMO_USERNAME: 'Demo', DEMO_PASSWORD: password })).toEqual({
      username: 'Demo',
      password,
    });
  });
  it.each([
    { DEMO_USERNAME: 'Demo' },
    { DEMO_PASSWORD: 'Synthetic-Test-9384!' },
    { DEMO_USERNAME: 'other', DEMO_PASSWORD: 'Synthetic-Test-9384!' },
    { DEMO_USERNAME: 'Demo', DEMO_PASSWORD: 'short' },
    { DEMO_USERNAME: 'Demo', DEMO_PASSWORD: 'x'.repeat(300) },
  ])('rechaza configuración incompleta o débil sin imprimirla', (env) => {
    expect(() => readDemoCredentials(env)).toThrow('credenciales privadas válidas');
  });
});
