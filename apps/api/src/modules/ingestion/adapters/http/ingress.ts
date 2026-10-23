import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { DemoMaintenance } from '../../../../platform/runtime/demo-maintenance.js';
import { rateLimit, MemoryStore } from 'express-rate-limit';
import type { Request, Response, RequestHandler } from 'express';
import {
  authenticateProducer,
  ProducerAuthenticationError,
} from '../../../../platform/http/producer-auth.js';
import { ProblemDetailsError } from '../../../../platform/http/problem.js';
import { ingestionProblem } from './problem.js';
import { readIngestionLimits } from './config.js';

interface IngestionContext {
  readonly requestId: string;
  readonly deadline: number;
  readonly signal: AbortSignal;
  readonly generation: number;
}
class ProducerQuotaError extends Error {}

@Injectable()
export class IngestionIngress implements OnModuleDestroy {
  readonly limits = readIngestionLimits(process.env);
  private readonly expected: string;
  private readonly contexts = new WeakMap<Request, IngestionContext>();
  private readonly stores: MemoryStore[] = [];
  private readonly postQuota: RequestHandler;
  private readonly readQuota: RequestHandler;
  private active = 0;

  constructor(@Optional() private readonly maintenance: DemoMaintenance = new DemoMaintenance()) {
    const value = process.env['INGEST_API_KEY'];
    if (!value || !/^[a-f0-9]{64}$/.test(value))
      throw new Error('Configuración de ingesta inválida.');
    this.expected = value;
    const quota = (identity: string) => {
      const store = new MemoryStore();
      this.stores.push(store);
      return rateLimit({
        windowMs: 60000,
        limit: 1200,
        store,
        keyGenerator: () => identity,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        passOnStoreError: false,
        handler: (_request, _response, next) => next(new ProducerQuotaError()),
        logger: {
          error: () => console.error('Limitador de ingesta no disponible.'),
          warn: () => console.error('Configuración del limitador de ingesta incompatible.'),
        },
      });
    };
    this.postQuota = quota('producer-post');
    this.readQuota = quota('producer-read');
  }

  isProducerRequest(request: Request): boolean {
    return (
      (request.method === 'POST' && /^\/api\/events\/batch\/?$/i.test(request.path)) ||
      (request.method === 'GET' && /^\/api\/ingestions\/[^/]+\/?$/i.test(request.path))
    );
  }

  context(request: Request): IngestionContext {
    const context = this.contexts.get(request);
    if (!context) throw new Error('Canalización de ingesta no aplicada.');
    return context;
  }

  run<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    return this.maintenance.ingestion(this.context(request).generation, operation);
  }

  readonly middleware: RequestHandler = (request, response, next) => {
    if (!this.isProducerRequest(request)) {
      next();
      return;
    }
    const requestId = randomUUID();
    const deadline = Date.now() + 60000;
    void this.authorize(request, response, requestId, deadline).then(
      () => {
        if (!response.destroyed && !request.aborted) next();
      },
      (error) => {
        if (response.destroyed) return;
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const problem =
          error instanceof ProducerAuthenticationError
            ? ingestionProblem('INVALID_API_KEY', requestId)
            : error instanceof ProducerQuotaError
              ? ingestionProblem('RATE_LIMITED', requestId)
              : error instanceof ProblemDetailsError
                ? error
                : ingestionProblem('INGESTION_STATUS_UNAVAILABLE', requestId);
        response
          .status(problem.getStatus())
          .type('application/problem+json')
          .json(problem.getResponse());
        request.resume();
      },
    );
  };

  private async authorize(
    request: Request,
    response: Response,
    requestId: string,
    deadline: number,
  ): Promise<void> {
    authenticateProducer(request, this.expected);
    const generation = this.maintenance.generation;
    const post = request.method === 'POST';
    if (post && this.maintenance.active)
      throw ingestionProblem('INGESTION_CAPACITY_EXCEEDED', requestId);
    await new Promise<void>((resolve, reject) => {
      const result = (post ? this.postQuota : this.readQuota)(request, response, (error) =>
        error ? reject(error) : resolve(),
      );
      Promise.resolve(result).catch(reject);
    });
    if (response.destroyed) return;
    if (post && (this.maintenance.active || generation !== this.maintenance.generation))
      throw ingestionProblem('INGESTION_CAPACITY_EXCEEDED', requestId);
    if (post && this.active >= 16) throw ingestionProblem('INGESTION_CAPACITY_EXCEEDED', requestId);
    if (post) this.active += 1;
    const controller = new AbortController();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (post) this.active -= 1;
      this.contexts.delete(request);
      controller.abort();
      response.off('finish', release);
      response.off('close', release);
      request.off('aborted', release);
    };
    this.contexts.set(request, { requestId, deadline, signal: controller.signal, generation });
    response.once('finish', release).once('close', release);
    request.once('aborted', release);
    if (request.aborted || response.destroyed) release();
  }

  onModuleDestroy(): void {
    for (const store of this.stores) store.shutdown();
  }
}
