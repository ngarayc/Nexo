import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

export async function createApplication() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
