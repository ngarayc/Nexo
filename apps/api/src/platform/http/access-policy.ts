import { SetMetadata } from '@nestjs/common';

export type AccessPolicy =
  'public' | 'login' | 'session-read' | 'session-write' | 'producer' | 'demo-read';
export const ACCESS_POLICY = Symbol('access-policy');
export const RequireAccess = (policy: AccessPolicy) => SetMetadata(ACCESS_POLICY, policy);
