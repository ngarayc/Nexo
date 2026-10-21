import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import session from 'express-session';
import { csrfSync } from 'csrf-sync';
import type { Request, Response, RequestHandler } from 'express';
import { ACCESS_CONFIG } from './access-config.js';
import type { AccessConfig } from './access-config.js';
import { BoundedSessionStore } from './session-store.js';
import { accessError } from './access-error.js';

@Injectable()
export class Sessions implements OnModuleDestroy {
  readonly store: BoundedSessionStore;
  readonly middleware: RequestHandler;
  private readonly csrf = csrfSync({
    getTokenFromRequest: (request) => request.get('X-CSRF-Token'),
  });
  private readonly cookie = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: false,
    path: '/',
  };

  constructor(@Inject(ACCESS_CONFIG) private readonly config: AccessConfig) {
    this.store = new BoundedSessionStore(config.maximumSessions);
    this.middleware = session({
      name: 'nexo.sid',
      secret: config.secret,
      store: this.store,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: { ...this.cookie, maxAge: config.sessionMilliseconds },
    });
  }

  require(request: Request) {
    const identity = request.session?.identity;
    if (
      !this.config.demoEnabled ||
      !identity ||
      identity.expiresAt <= Date.now() ||
      !this.store.isActive(request.sessionID)
    ) {
      throw accessError('SESSION_REQUIRED', 403, 'Tu sesión venció. Inicia sesión de nuevo.');
    }
    return identity;
  }

  get demoEnabled(): boolean {
    return this.config.demoEnabled;
  }

  requireOrigin(request: Request): void {
    if (request.get('Origin') !== this.config.origin) throw accessError('ORIGIN_NOT_ALLOWED');
  }

  requireCsrf(request: Request): void {
    if (!this.csrf.isRequestValid(request)) throw accessError('INVALID_CSRF_TOKEN');
  }

  async create(request: Request, user: { id: string; username: 'demo' }): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      request.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    const issuedAt = Date.now();
    const expiresAt = issuedAt + this.config.sessionMilliseconds;
    if (!this.store.reserve(request.sessionID, expiresAt)) {
      await new Promise<void>((resolve, reject) =>
        request.session.destroy((error) => (error ? reject(error) : resolve())),
      );
      throw accessError(
        'SESSION_CAPACITY_REACHED',
        503,
        'Se alcanzó el límite de sesiones activas.',
      );
    }
    request.session.identity = { user, issuedAt, expiresAt };
    request.session.cookie.expires = new Date(expiresAt);
    this.csrf.generateToken(request);
    try {
      await new Promise<void>((resolve, reject) =>
        request.session.save((error) => (error ? reject(error) : resolve())),
      );
    } catch (error) {
      // Impide que express-session reintente guardar o emita una cookie al finalizar.
      await new Promise<void>((resolve) => request.session.destroy(() => resolve()));
      throw error;
    }
  }

  describe(request: Request) {
    const identity = this.require(request);
    return {
      user: identity.user,
      expiresAt: new Date(identity.expiresAt).toISOString(),
      csrfToken: request.session.csrfToken,
    };
  }

  async logout(request: Request, response: Response): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    response.clearCookie('nexo.sid', this.cookie);
  }

  onModuleDestroy(): void {
    this.store.close();
  }
}
