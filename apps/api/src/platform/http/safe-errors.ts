import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ProblemDetailsError } from './problem.js';

export const unavailableBody = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'Servicio temporalmente no disponible.',
};

@Catch()
export class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent || response.destroyed) return;
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      if (error instanceof ProblemDetailsError) response.type('application/problem+json');
      response.status(error.getStatus()).json(error.getResponse());
    } else {
      response.status(503).json(unavailableBody);
    }
  }
}
