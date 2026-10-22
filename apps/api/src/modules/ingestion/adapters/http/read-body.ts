import type { Request } from 'express';
import { readJsonBody, JsonBodyError } from '../../../../platform/http/read-body.js';
import { ingestionProblem } from './problem.js';

export async function readIngestionBody(
  request: Request,
  maximum: number,
  deadline: number,
  requestId: string,
): Promise<string> {
  try {
    return await readJsonBody(request, maximum, deadline);
  } catch (error) {
    if (error instanceof JsonBodyError) throw ingestionProblem(error.code, requestId);
    throw error;
  }
}
