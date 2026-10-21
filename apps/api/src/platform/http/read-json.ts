import { HttpException } from '@nestjs/common';
import type { Request } from 'express';

export async function readJson(request: Request, maximum: number): Promise<unknown> {
  const invalid = (status = 400) =>
    new HttpException(
      {
        code: status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_JSON',
        message: 'Revisa el formato y el tamaño de la solicitud.',
      },
      status,
    );
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.get('content-type') ?? '') ||
    !['', 'identity'].includes(request.get('content-encoding') ?? '')
  )
    throw invalid();
  const length = request.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw invalid(413);
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', aborted);
      request.off('error', aborted);
    };
    const fail = (error: Error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) return fail(invalid(413));
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(invalid());
    const timer = setTimeout(() => fail(invalid(408)), 15000);
    timer.unref();
    request.on('data', data).once('end', end).once('aborted', aborted).once('error', aborted);
  });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw invalid();
  }
}
