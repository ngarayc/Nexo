export interface SessionSnapshot {
  readonly user: { readonly id: string; readonly username: 'demo' | 'Demo' };
  readonly expiresAt: string;
  readonly csrfToken: string;
}
