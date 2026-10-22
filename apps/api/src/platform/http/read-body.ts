import type { Request } from 'express';

export type JsonBodyCode =
  'UNSUPPORTED_MEDIA_TYPE' | 'BODY_TOO_LARGE' | 'REQUEST_TIMEOUT' | 'MALFORMED_JSON';
export class JsonBodyError extends Error {
  constructor(readonly code: JsonBodyCode) {
    super(code);
  }
}

// Compartido por ingesta y consultas JSON; autenticar antes de llamarlo.
export async function readJsonBody(
  request: Request,
  maximum: number,
  deadline: number,
): Promise<string> {
  const invalid = (code: JsonBodyCode) => new JsonBodyError(code);
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:"utf-8"|utf-8))?\s*$/i.test(
      request.get('content-type') ?? '',
    ) ||
    !['', 'identity'].includes((request.get('content-encoding') ?? '').trim().toLowerCase())
  )
    throw invalid('UNSUPPORTED_MEDIA_TYPE');
  const declared = request.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || BigInt(declared) > BigInt(maximum)))
    throw invalid('BODY_TOO_LARGE');
  if (request.aborted || Date.now() >= deadline) throw invalid('REQUEST_TIMEOUT');
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', aborted);
      request.off('error', aborted);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.resume();
      reject(error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) return fail(invalid('BODY_TOO_LARGE'));
      chunks.push(chunk);
    };
    const end = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(invalid('REQUEST_TIMEOUT'));
    const timer = setTimeout(aborted, Math.max(1, deadline - Date.now()));
    request.on('data', data).once('end', end).once('aborted', aborted).once('error', aborted);
  });
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalid('MALFORMED_JSON');
  }
}
