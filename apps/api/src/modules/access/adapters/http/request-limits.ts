import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { rateLimit, MemoryStore } from 'express-rate-limit';
import type { Request, Response, RequestHandler } from 'express';
import { ACCESS_CONFIG } from './access-config.js';
import type { AccessConfig } from './access-config.js';
import { accessError } from './access-error.js';

@Injectable()
export class RequestLimits implements OnModuleDestroy {
  private readonly stores: MemoryStore[] = [];
  private readonly login: RequestHandler;
  private readonly reads: RequestHandler;

  constructor(@Inject(ACCESS_CONFIG) config: AccessConfig) {
    const create = (limit: number, key: string) => {
      const store = new MemoryStore();
      this.stores.push(store);
      return rateLimit({
        windowMs: config.windowMilliseconds,
        limit,
        store,
        keyGenerator: () => key,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        passOnStoreError: false,
        handler: (_request, _response, next) =>
          next(
            accessError(
              'RATE_LIMITED',
              429,
              'Demasiadas solicitudes. Espera antes de intentarlo de nuevo.',
            ),
          ),
        logger: {
          error: () => console.error('Fallo de configuración del limitador.'),
          warn: () => console.error('Advertencia del limitador.'),
        },
      });
    };
    this.login = create(config.loginLimit, 'login');
    this.reads = create(config.readLimit, 'demo');
  }

  async consume(kind: 'login' | 'read', request: Request, response: Response): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const result = (kind === 'login' ? this.login : this.reads)(
        request,
        response,
        (error?: unknown) => (error ? reject(error) : resolve()),
      );
      Promise.resolve(result).catch(reject);
    });
  }

  onModuleDestroy(): void {
    for (const store of this.stores) store.shutdown();
  }
}
