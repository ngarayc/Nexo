import { PassThrough } from 'node:stream';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsError } from '../../../../platform/http/problem.js';
import { readIngestionBody } from './read-body.js';

function incoming(headers: Record<string, string> = {}) {
  return Object.assign(new PassThrough(), {
    get: (name: string) => headers[name.toLowerCase()],
    aborted: false,
  }) as unknown as Request;
}
async function problem(promise: Promise<unknown>, code: string, status: number) {
  try {
    await promise;
    throw new Error('Se esperaba rechazo de transporte.');
  } catch (error) {
    if (!(error instanceof ProblemDetailsError)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({
      code,
      status,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      errors: [],
      admission: 'not_admitted',
      resultsAvailable: false,
      requestId: 'request-example',
    });
  }
}
const read = (request: Request, maximum = 16, deadline = Date.now() + 1000) =>
  readIngestionBody(request, maximum, deadline, 'request-example');

describe('lectura incremental UTF-8 de ingesta sin coerción ni parser global', () => {
  afterEach(() => vi.useRealTimers());
  it('conserva el texto y recompone un carácter UTF-8 fragmentado sin Content-Length', async () => {
    const request = incoming({ 'content-type': 'application/json; charset="UTF-8"' });
    const source = ' "é" ';
    const bytes = Buffer.from(source);
    const result = read(request);
    request.emit('data', bytes.subarray(0, 3));
    request.emit('data', bytes.subarray(3));
    request.emit('end');
    expect(await result).toBe(source);
    for (const event of ['data', 'end', 'aborted', 'error'])
      expect(request.listenerCount(event)).toBe(0);
  });
  it('admite el tamaño exacto y rechaza el byte adicional aun sin longitud declarada', async () => {
    const exact = incoming({ 'content-type': 'application/json' });
    const accepted = read(exact, 8);
    exact.emit('data', Buffer.from('1234'));
    exact.emit('data', Buffer.from('5678'));
    exact.emit('end');
    expect(await accepted).toBe('12345678');
    const over = incoming({ 'content-type': 'application/json' });
    const rejected = problem(read(over, 8), 'BODY_TOO_LARGE', 413);
    over.emit('data', Buffer.from('1234'));
    over.emit('data', Buffer.from('56789'));
    await rejected;
    expect(over.listenerCount('data')).toBe(0);
  });
  it('una longitud declarada admisible no elude la comprobación incremental', async () => {
    const request = incoming({ 'content-type': 'application/json', 'content-length': '1' });
    const result = problem(read(request, 8), 'BODY_TOO_LARGE', 413);
    request.emit('data', Buffer.alloc(9));
    await result;
  });
  it('rechaza Content-Length mayor antes de acumular chunks', async () => {
    const request = incoming({ 'content-type': 'application/json', 'content-length': '17' });
    await problem(read(request), 'BODY_TOO_LARGE', 413);
    expect(request.listenerCount('data')).toBe(0);
  });
  it.each([
    { 'content-type': 'text/plain' },
    { 'content-type': 'application/json; charset=latin1' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
  ])('rechaza contenido o compresión ajenos antes de leer', async (headers) => {
    const request = incoming(headers);
    await problem(read(request), 'UNSUPPORTED_MEDIA_TYPE', 415);
    expect(request.listenerCount('data')).toBe(0);
  });
  it('no sustituye bytes UTF-8 inválidos silenciosamente', async () => {
    const request = incoming({ 'content-type': 'application/json' });
    const result = problem(read(request), 'MALFORMED_JSON', 400);
    request.emit('data', Buffer.from([0x22, 0xc3, 0x28, 0x22]));
    request.emit('end');
    await result;
  });
  it('vence el plazo sin retener listeners o temporizadores', async () => {
    vi.useFakeTimers();
    const request = incoming({ 'content-type': 'application/json' });
    const result = problem(read(request), 'REQUEST_TIMEOUT', 408);
    request.emit('data', Buffer.from('{'));
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    for (const event of ['data', 'end', 'aborted', 'error'])
      expect(request.listenerCount(event)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('un stream abortado no entrega una entrada parcial ni expone el error', async () => {
    const request = incoming({ 'content-type': 'application/json' });
    const result = problem(read(request), 'REQUEST_TIMEOUT', 408);
    request.emit('data', Buffer.from('{'));
    request.emit('aborted');
    await result;
    expect(request.listenerCount('data')).toBe(0);
  });
});
