import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ACCESS_POLICY } from '../../../../platform/http/access-policy.js';
import type { AccessPolicy } from '../../../../platform/http/access-policy.js';
import { Sessions } from './sessions.js';
import { RequestLimits } from './request-limits.js';
import { accessError } from './access-error.js';
import { isAuthenticatedProducer } from '../../../../platform/http/producer-auth.js';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: Sessions,
    private readonly limits: RequestLimits,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (policy === 'public') return true;
    if (policy === 'producer') {
      if (!isAuthenticatedProducer(request)) throw accessError('INVALID_API_KEY');
      return true;
    }
    if (policy === 'demo-read' && !this.sessions.demoEnabled)
      throw accessError('DEMO_DISABLED', 404, 'Recurso no disponible.');
    if (policy === 'login') {
      this.sessions.requireOrigin(request);
      return true;
    }
    if (
      policy !== 'session-read' &&
      policy !== 'session-query' &&
      policy !== 'session-write' &&
      policy !== 'demo-read'
    )
      throw accessError('ACCESS_POLICY_REQUIRED');
    this.sessions.require(request);
    if (policy === 'session-write' || policy === 'session-query') {
      this.sessions.requireOrigin(request);
      this.sessions.requireCsrf(request);
    }
    if (policy !== 'session-write') {
      await this.limits.consume('read', request, http.getResponse<Response>());
    }
    return true;
  }
}
