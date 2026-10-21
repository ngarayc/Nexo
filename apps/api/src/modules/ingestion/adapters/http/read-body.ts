import type { Request } from 'express';
import { ingestionProblem } from './problem.js';

export async function readIngestionBody(
  request: Request,
  maximum: number,
  deadline: number,
  requestId: string,
): Promise<string> {
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:"utf-8"|utf-8))?\s*$/i.test(
      request.get('content-type') ?? '',
    ) ||
    !['', 'identity'].includes((request.get('content-encoding') ?? '').trim().toLowerCase())
  ) {
    throw ingestionProblem('UNSUPPORTED_MEDIA_TYPE', requestId);
  }
  const declared = request.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || BigInt(declared) > BigInt(maximum)))
    throw ingestionProblem('BODY_TOO_LARGE', requestId);
  if (request.aborted || Date.now() >= deadline)
    throw ingestionProblem('REQUEST_TIMEOUT', requestId);
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
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
      if (size > maximum) return fail(ingestionProblem('BODY_TOO_LARGE', requestId));
      chunks.push(chunk);
    };
    const end = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(ingestionProblem('REQUEST_TIMEOUT', requestId));
    const timer = setTimeout(aborted, Math.max(1, deadline - Date.now()));
    request.on('data', data).once('end', end).once('aborted', aborted).once('error', aborted);
  });
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw ingestionProblem('MALFORMED_JSON', requestId);
  }
}
