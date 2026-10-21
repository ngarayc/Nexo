import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const authorized = new WeakSet<Request>();

export class ProducerAuthenticationError extends Error {
  constructor() {
    super('No fue posible autorizar el productor.');
  }
}

export function authenticateProducer(request: Request, expected: string): void {
  authorized.delete(request);
  const supplied = request.get('X-API-Key');
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Configuración del productor inválida.');
  if (
    !supplied ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(expected, 'utf8'))
  )
    throw new ProducerAuthenticationError();
  authorized.add(request);
}

export function isAuthenticatedProducer(request: Request): boolean {
  return authorized.has(request);
}
