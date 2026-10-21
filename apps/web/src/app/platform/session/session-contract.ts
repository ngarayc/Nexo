export interface SessionSnapshot {
  readonly user: { readonly id: string; readonly username: 'demo' };
  readonly expiresAt: string;
  readonly csrfToken: string;
}
