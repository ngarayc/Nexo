import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MemoryStore } from 'express-rate-limit';
import request from 'supertest';
import { configureApplication } from '../../../../app.factory.js';
import { AccessModule } from '../../../access/public.js';
import { Authenticate } from '../../../access/application/authenticate.js';
import { Ingest } from '../../application/ingest.js';
import type { IngestionResult } from '../../application/ingest.js';
import type { Receipt } from '../../application/receipt.js';
import { ReceiptReader } from '../postgres/receipt-reader.js';
import { IngestionController } from './ingestion-controller.js';
import { IngestionIngress } from './ingress.js';

// Bibliotecas HTTP/sesión/cuotas reales; persistencia y clasificación se sustituyen aquí.
vi.mock('../../../../platform/database/database.service.js', () => ({
  DatabaseService: class {
    async isHealthy() {
      return true;
    }
  },
}));
const producerSecret = '1'.repeat(64);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const receipt = (ingestionId = id): Receipt => ({
  ingestionId,
  revision: 1,
  complete: true,
  total: 1,
  accepted: 0,
  duplicates: 0,
  rejected: 1,
  results: [{ index: 0, eventId: null, outcome: 'rejected' }],
  errors: [{ index: 0, eventId: null, reason: 'INVALID_EVENT' }],
  pendingIndexes: [],
  failedIndexes: [],
  failures: [],
});
const pending: Receipt = {
  ...receipt(),
  revision: 0,
  complete: false,
  rejected: 0,
  results: [],
  errors: [],
  pendingIndexes: [0],
};

describe('ingesta HTTP: autenticación anterior al parser y contratos de recibos', () => {
  let app: NestExpressApplication | undefined;
  const ingest = {
    execute: vi.fn<Ingest['execute']>(async (ingestionId: string): Promise<IngestionResult> => ({
      state: 'complete',
      receipt: receipt(ingestionId),
    })),
  };
  const reader = {
    find: vi.fn(async (ingestionId: string): Promise<Receipt | undefined> =>
      ingestionId === id ? receipt() : undefined,
    ),
  };
  async function start() {
    const module = await Test.createTestingModule({
      imports: [AccessModule],
      controllers: [IngestionController],
      providers: [
        IngestionIngress,
        { provide: Ingest, useValue: ingest },
        { provide: ReceiptReader, useValue: reader },
      ],
    })
      .overrideProvider(Authenticate)
      .useValue({ execute: async () => ({ id: 'account', username: 'demo' }) })
      .compile();
    app = configureApplication(
      module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false }),
    );
    await app.listen(0, '127.0.0.1');
    return request(app.getHttpServer());
  }
  beforeEach(() => {
    vi.stubEnv('PUBLIC_ORIGIN', 'http://localhost:8080');
    vi.stubEnv('SESSION_SECRET', '2'.repeat(64));
    vi.stubEnv('INGEST_API_KEY', producerSecret);
    vi.stubEnv('DEMO_ENABLED', 'true');
    ingest.execute.mockReset().mockImplementation(async (ingestionId: string) => ({
      state: 'complete',
      receipt: receipt(ingestionId),
    }));
    reader.find
      .mockReset()
      .mockImplementation(async (ingestionId: string) =>
        ingestionId === id ? receipt() : undefined,
      );
  });
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('clave inválida precede al JSON y una cookie no sustituye al productor', async () => {
    const client = await start();
    for (const supplied of [undefined, 'demo', '2'.repeat(64)]) {
      const call = client
        .post('/api/events/batch')
        .set('Cookie', 'nexo.sid=invalid')
        .set('Content-Type', 'application/json');
      if (supplied) call.set('X-API-Key', supplied);
      const denied = await call.send('{').expect(403);
      expect(denied.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(denied.headers['cache-control']).toBe('no-store');
      expect(denied.body).toMatchObject({
        code: 'INVALID_API_KEY',
        admission: 'not_admitted',
        resultsAvailable: false,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        errors: [],
      });
      expect(JSON.stringify(denied.body)).not.toContain(producerSecret);
    }
    expect(ingest.execute).not.toHaveBeenCalled();
  });

  it('un productor autorizado funciona sin cookie, Origin o CSRF y conserva el original', async () => {
    const client = await start();
    const source = ' {"events":[null],"extra":9007199254740993} ';
    const response = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .set('Idempotency-Key', id)
      .set('Cookie', 'nexo.sid=invalid')
      .set('Origin', 'https://foreign.example')
      .set('Content-Type', 'application/json')
      .send(source)
      .expect(200);
    expect(response.body).toMatchObject(receipt());
    expect(response.headers['set-cookie']).toBeUndefined();
    const args = ingest.execute.mock.calls[0];
    expect(args?.[0]).toBe(id);
    expect(args?.[1].document.raw).toBe(source);
    expect(args?.[3]).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['{', 400, 'MALFORMED_JSON'],
    ['{"events":[]}', 400, 'EMPTY_BATCH'],
    ['{"events":null}', 400, 'INVALID_BATCH'],
  ])('rechaza formato/sobre después de autorizar sin admitir', async (source, status, code) => {
    const client = await start();
    const response = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .set('Content-Type', 'application/json')
      .send(source)
      .expect(status);
    expect(response.body.code).toBe(code);
    expect(ingest.execute).not.toHaveBeenCalled();
  });

  it('tipo/compresión y UUID incorrectos se rechazan sin llamar al caso de uso', async () => {
    const client = await start();
    expect(
      (
        await client
          .post('/api/events/batch')
          .set('X-API-Key', producerSecret)
          .set('Content-Type', 'text/plain')
          .send('{')
          .expect(415)
      ).body.code,
    ).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(
      (
        await client
          .post('/api/events/batch')
          .set('X-API-Key', producerSecret)
          .set('Idempotency-Key', 'bad')
          .send({ events: [null] })
          .expect(400)
      ).body.code,
    ).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(ingest.execute).not.toHaveBeenCalled();
  });

  it('cuerpo exacto de 2 MiB pasa y +1 no llega a la admisión', async () => {
    const client = await start();
    const prefix = '{"events":[null]}';
    const exact = prefix + ' '.repeat(2 * 1024 * 1024 - Buffer.byteLength(prefix));
    await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .set('Content-Type', 'application/json')
      .send(exact)
      .expect(200);
    expect(ingest.execute).toHaveBeenCalledTimes(1);
    expect(
      (
        await client
          .post('/api/events/batch')
          .set('X-API-Key', producerSecret)
          .set('Content-Type', 'application/json')
          .send(exact + ' ')
          .expect(413)
      ).body.code,
    ).toBe('BODY_TOO_LARGE');
    expect(ingest.execute).toHaveBeenCalledTimes(1);
  });

  it('pendiente, fallo técnico y estado no comprobable mantienen significados distintos', async () => {
    const client = await start();
    ingest.execute.mockResolvedValueOnce({ state: 'pending', receipt: pending });
    const waiting = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(503);
    expect(waiting.body).toMatchObject({
      code: 'INGESTION_RESULT_PENDING',
      resultsAvailable: true,
      admission: 'admitted',
      pendingIndexes: [0],
      failedIndexes: [],
      complete: false,
    });
    ingest.execute.mockResolvedValueOnce({
      state: 'failed',
      receipt: {
        ...pending,
        pendingIndexes: [],
        failedIndexes: [0],
        failures: [{ index: 0, code: 'RETRY_EXHAUSTED' }],
      },
    });
    const failed = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(500);
    expect(failed.body).toMatchObject({
      code: 'INGESTION_PROCESSING_FAILED',
      rejected: 0,
      failedIndexes: [0],
      resultsAvailable: true,
      complete: false,
    });
    ingest.execute.mockResolvedValueOnce({
      state: 'unavailable',
      ingestionId: id,
      admission: 'unknown',
    });
    const unavailable = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(503);
    expect(unavailable.body).toMatchObject({
      code: 'INGESTION_STATUS_UNAVAILABLE',
      admission: 'unknown',
      resultsAvailable: false,
      accepted: 0,
    });
    for (const field of ['revision', 'pendingIndexes', 'failedIndexes', 'total'])
      expect(unavailable.body).not.toHaveProperty(field);
  });

  it('lectura exige su acceso, distingue no encontrado/indisponible y no admite trabajo', async () => {
    const client = await start();
    await client.get(`/api/ingestions/${id}`).expect(403);
    expect(
      (await client.get(`/api/ingestions/${id}`).set('X-API-Key', producerSecret).expect(200)).body,
    ).toMatchObject(receipt());
    expect(
      (await client.get('/api/ingestions/bad').set('X-API-Key', producerSecret).expect(400)).body
        .code,
    ).toBe('INVALID_INGESTION_ID');
    reader.find.mockResolvedValueOnce(undefined);
    expect(
      (await client.get(`/api/ingestions/${id}`).set('X-API-Key', producerSecret).expect(404)).body
        .code,
    ).toBe('INGESTION_NOT_FOUND');
    reader.find.mockRejectedValueOnce(new Error('private-reader-detail'));
    const unavailable = await client
      .get(`/api/ingestions/${id}`)
      .set('X-API-Key', producerSecret)
      .expect(503);
    expect(unavailable.body.code).toBe('INGESTION_STATUS_UNAVAILABLE');
    expect(JSON.stringify(unavailable.body)).not.toContain('private-reader-detail');
    expect(ingest.execute).not.toHaveBeenCalled();
  });

  it('recibo de demo usa sesión y devuelve 404 con demo deshabilitada', async () => {
    vi.stubEnv('DEMO_ENABLED', 'false');
    const client = await start();
    await client.get(`/api/demo/ingestions/${id}`).set('X-API-Key', producerSecret).expect(404);
    expect(reader.find).not.toHaveBeenCalled();
  });

  it('sesión de demo lee el mismo recibo sin entregar la API key y no sustituye al productor', async () => {
    const client = await start();
    await client.get(`/api/demo/ingestions/${id}`).set('X-API-Key', producerSecret).expect(403);
    const login = await client
      .post('/api/session')
      .set('Origin', 'http://localhost:8080')
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    expect(typeof cookie).toBe('string');
    const response = await client
      .get(`/api/demo/ingestions/${id}`)
      .set('Cookie', cookie!)
      .expect(200);
    expect(response.body).toMatchObject(receipt());
    expect(JSON.stringify(response.body)).not.toContain(producerSecret);
    await client.get(`/api/ingestions/${id}`).set('Cookie', cookie!).expect(403);
    expect(ingest.execute).not.toHaveBeenCalled();
  });

  it('mil posiciones pasan al clasificador y mil una no admiten trabajo', async () => {
    const client = await start();
    await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: Array(1000).fill(null) })
      .expect(200);
    expect(ingest.execute.mock.calls[0]?.[1].items.length).toBe(1000);
    const rejected = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: Array(1001).fill(null) })
      .expect(413);
    expect(rejected.body.code).toBe('BATCH_TOO_LARGE');
    expect(ingest.execute).toHaveBeenCalledTimes(1);
  });

  it('dieciséis POST pueden esperar; el siguiente se rechaza antes del cuerpo y el cupo se recupera', async () => {
    const client = await start();
    let unblock!: () => void;
    const held = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    ingest.execute.mockImplementation(async (ingestionId) => {
      await held;
      return { state: 'complete', receipt: receipt(ingestionId) };
    });
    const calls = Array.from({ length: 16 }, () =>
      client
        .post('/api/events/batch')
        .set('X-API-Key', producerSecret)
        .send({ events: [null] })
        .then((response) => response),
    );
    const settled = Promise.allSettled(calls);
    try {
      const deadline = Date.now() + 2000;
      while (ingest.execute.mock.calls.length < 16 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(ingest.execute).toHaveBeenCalledTimes(16);
      const denied = await client
        .post('/api/events/batch')
        .set('X-API-Key', producerSecret)
        .set('Content-Type', 'application/json')
        .send('{')
        .expect(503);
      expect(denied.body.code).toBe('INGESTION_CAPACITY_EXCEEDED');
      expect(ingest.execute).toHaveBeenCalledTimes(16);
    } finally {
      unblock();
    }
    const results = await settled;
    expect(
      results.every((result) => result.status === 'fulfilled' && result.value.status === 200),
    ).toBe(true);
    await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(200);
  });

  it('la cuota de POST no consume la de lectura y un fallo del limitador no revela detalles', async () => {
    const client = await start();
    vi.spyOn(MemoryStore.prototype, 'increment').mockImplementation(async (identity) => ({
      totalHits: identity === 'producer-post' ? 1201 : 1,
      resetTime: new Date(Date.now() + 60000),
    }));
    await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(429);
    await client.get(`/api/ingestions/${id}`).set('X-API-Key', producerSecret).expect(200);
    vi.mocked(MemoryStore.prototype.increment).mockRejectedValue(new Error('private-quota-detail'));
    const failed = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(503);
    expect(failed.body.code).toBe('INGESTION_STATUS_UNAVAILABLE');
    expect(JSON.stringify(failed.body)).not.toContain('private-quota-detail');
    expect(ingest.execute).not.toHaveBeenCalled();
  });

  it('1200 llamadas están dentro de la cuota y 1201 se rechaza antes del parser; clave inválida sigue siendo 403', async () => {
    const client = await start();
    const increment = vi
      .spyOn(MemoryStore.prototype, 'increment')
      .mockResolvedValue({ totalHits: 1200, resetTime: new Date(Date.now() + 60000) });
    await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .send({ events: [null] })
      .expect(200);
    increment.mockResolvedValue({ totalHits: 1201, resetTime: new Date(Date.now() + 60000) });
    const denied = await client
      .post('/api/events/batch')
      .set('X-API-Key', producerSecret)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(429);
    expect(denied.body.code).toBe('RATE_LIMITED');
    await client
      .post('/api/events/batch')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(403);
    expect(ingest.execute).toHaveBeenCalledTimes(1);
  });
});
