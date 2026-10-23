export interface SessionIdentity {
  readonly user: { readonly id: string; readonly username: 'demo' | 'Demo' };
  readonly issuedAt: number;
  readonly expiresAt: number;
}

declare module 'express-session' {
  interface SessionData {
    identity?: SessionIdentity;
  }
}
