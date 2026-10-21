import { HttpException } from '@nestjs/common';

export interface ProblemDetails extends Readonly<Record<string, unknown>> {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly requestId: string;
}

export class ProblemDetailsError extends HttpException {
  constructor(body: ProblemDetails) {
    super(body, body.status);
  }
}
