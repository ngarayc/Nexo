import { SetMetadata } from '@nestjs/common';

export type AccessPolicy =
  | 'public'
  | 'login'
  | 'session-read'
  | 'session-query'
  | 'session-stream'
  | 'session-write'
  | 'producer'
  | 'demo-read'
  | 'demo-write';
export const ACCESS_POLICY = Symbol('access-policy');
export const RequireAccess = (policy: AccessPolicy) => SetMetadata(ACCESS_POLICY, policy);
