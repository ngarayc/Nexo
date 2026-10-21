import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from './app.factory.js';

describe('bootstrap HTTP y metadatos de inyección Nest', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('resuelve el servicio inyectado y atiende bajo /api', async () => {
    app = await createApplication();
    await app.init();
    const response = await request(app.getHttpServer()).get('/api').expect(200);
    expect(response.body).toEqual({ name: 'Nexo' });
  });

  it('no anuncia salud de PostgreSQL antes de incorporar esa dependencia', async () => {
    app = await createApplication();
    await app.init();
    await request(app.getHttpServer()).get('/api/health').expect(404);
  });
});
