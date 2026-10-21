import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Sessions } from './modules/access/public.js';
import { IngestionIngress } from './modules/ingestion/public.js';
import { SafeErrors, unavailableBody } from './platform/http/safe-errors.js';
import type { Request, Response, NextFunction } from 'express';

export async function createApplication() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  return configureApplication(app);
}

export function configureApplication(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api');
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.set('trust proxy', false);
  app.use(
    helmet({
      strictTransportSecurity: false,
      xFrameOptions: { action: 'deny' },
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  const sessions = app.get(Sessions);
  const ingestion = app.get(IngestionIngress);
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(ingestion.middleware);
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (ingestion.isProducerRequest(request)) {
      next();
      return;
    }
    sessions.middleware(request, response, (error?: unknown) => {
      if (error) {
        if (response.headersSent) response.destroy();
        else response.status(503).json(unavailableBody);
      } else next();
    });
  });
  app.useGlobalFilters(new SafeErrors());
  app.enableShutdownHooks();
  return app;
}
