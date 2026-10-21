import { afterEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication } from './app.factory.js';

// El transporte se prueba aquí sin una base; la salud real exige integración SQL.
vi.mock('./platform/database/database.service.js', () => ({
  DatabaseService: class {
    async isHealthy() {
      return true;
    }
  },
}));

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

  it('publica el contrato de salud usando el adaptador inyectado', async () => {
    app = await createApplication();
    await app.init();
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok', schema: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
