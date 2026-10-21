import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  authenticateProducer,
  isAuthenticatedProducer,
  ProducerAuthenticationError,
} from './producer-auth.js';

const configured = '1'.repeat(64);
const requestWith = (value: string | undefined) => ({ get: () => value }) as unknown as Request;

describe('API key literal y marca interna de autenticación pre-parser', () => {
  it('autoriza únicamente el objeto autenticado, sin guardar la clave en él', () => {
    const request = requestWith(configured);
    const fields = Reflect.ownKeys(request);
    expect(isAuthenticatedProducer(request)).toBe(false);
    authenticateProducer(request, configured);
    expect(isAuthenticatedProducer(request)).toBe(true);
    expect(isAuthenticatedProducer(requestWith(configured))).toBe(false);
    expect(Reflect.ownKeys(request)).toEqual(fields);
  });
  it.each([
    undefined,
    '',
    'demo',
    '2'.repeat(64),
    '1'.repeat(63),
    '1'.repeat(65),
    ' ' + configured,
    '\u0131'.repeat(64),
  ])('rechaza ausencia, formato o valor ajeno sin truncar caracteres', (value) => {
    const request = requestWith(value);
    expect(() => authenticateProducer(request, configured)).toThrow(ProducerAuthenticationError);
    expect(isAuthenticatedProducer(request)).toBe(false);
  });
  it('un fallo posterior retira la marca y una configuración inválida no autoriza', () => {
    let supplied = configured;
    const request = { get: () => supplied } as unknown as Request;
    authenticateProducer(request, configured);
    supplied = '2'.repeat(64);
    expect(() => authenticateProducer(request, configured)).toThrow(ProducerAuthenticationError);
    expect(isAuthenticatedProducer(request)).toBe(false);
    expect(() => authenticateProducer(request, 'demo')).toThrow('Configuración');
  });
});
