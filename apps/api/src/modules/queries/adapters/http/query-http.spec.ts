import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApplication } from '../../../../app.factory.js';
import { AccessModule } from '../../../access/public.js';
import { DatabaseModule } from '../../../../platform/database/database.module.js';
import { Authenticate } from '../../../access/application/authenticate.js';
import { ACCESS_CONFIG } from '../../../access/adapters/http/access-config.js';
import { IngestionIngress } from '../../../ingestion/public.js';
import { DomainQueries } from '../../application/queries.js';
import { QueryController } from './query-controller.js';

// Sesión/CSRF/cuota/parser reales; el modelo SQL se verifica en integración.
vi.mock('../../../../platform/database/database.service.js', async () => {
  const { DatabaseSlots } = await import('../../../../platform/database/slots.js');
  return {
    DatabaseService: class {
      readonly querySlots = new DatabaseSlots(16, 0);
      async isHealthy() {
        return true;
      }
    },
  };
});
describe('consultas HTTP protegidas y sin escrituras', () => {
  let app: NestExpressApplication | undefined;
  const origin = 'http://localhost:8080';
  const history = vi.fn(async (vehicleId: string) => ({ vehicleId, items: [], total: 0 }));
  const fleet = vi.fn(async () => ({
    items: [],
    total: 0,
    overallTotal: 0,
    summary: { OFF: 0, MOVING: 0, STOPPED: 0 },
  }));
  const alerts = vi.fn(async (vehicleId?: string) => ({
    items: [],
    total: 0,
    overallTotal: vehicleId === undefined ? 0 : 4,
  }));
  async function start(readLimit = 600) {
    const module = await Test.createTestingModule({
      imports: [AccessModule, DatabaseModule],
      controllers: [QueryController],
      providers: [
        {
          provide: DomainQueries,
          useValue: {
            history,
            fleet,
            alerts,
            snapshot: async () => ({ schemaVersion: 1, instanceId: 'instance' }),
          },
        },
        {
          provide: IngestionIngress,
          useValue: {
            middleware: (_r: unknown, _s: unknown, next: () => void) => next(),
            isProducerRequest: () => false,
          },
        },
      ],
    })
      .overrideProvider(Authenticate)
      .useValue({ execute: async () => ({ id: 'account', username: 'demo' }) })
      .overrideProvider(ACCESS_CONFIG)
      .useValue({
        origin,
        secret: '2'.repeat(64),
        demoEnabled: true,
        sessionMilliseconds: 14400000,
        maximumSessions: 32,
        loginLimit: 10,
        readLimit,
        windowMilliseconds: 60000,
      })
      .compile();
    app = configureApplication(
      module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false }),
    );
    await app.listen(0, '127.0.0.1');
    const client = request.agent(app.getHttpServer());
    const logged = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    const post = (path = '/api/queries/vehicle-events') =>
      client
        .post(path)
        .set('Origin', origin)
        .set('X-CSRF-Token', logged.body.csrfToken as string);
    return { client, post };
  }
  beforeEach(() => {
    history.mockClear();
    fleet.mockClear();
    alerts.mockClear();
  });
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });
  it('sesión/origen/CSRF preceden al parser; API key no sustituye sesión', async () => {
    const { client } = await start();
    await request(app!.getHttpServer())
      .get('/api/vehicles')
      .set('X-API-Key', '1'.repeat(64))
      .expect(403);
    await request(app!.getHttpServer())
      .post('/api/queries/vehicle-events')
      .set('X-API-Key', '1'.repeat(64))
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(403);
    await client
      .post('/api/queries/vehicle-events')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(403);
    await client
      .post('/api/queries/vehicle-events')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(403);
    expect(history).not.toHaveBeenCalled();
  });
  it('GET y POST usan el mismo historial y preservan identificadores y desconocidos', async () => {
    const { client, post } = await start();
    const id = 'A/%_';
    expect(
      (await client.get(`/api/vehicles/${encodeURIComponent(id)}/events`).expect(200)).body,
    ).toEqual((await post().send({ vehicleId: id }).expect(200)).body);
    const escaped = '\ud800' + 'x'.repeat(12000);
    expect((await post().send({ vehicleId: escaped }).expect(200)).body.vehicleId).toBe(escaped);
    expect(history).toHaveBeenLastCalledWith(escaped);
  });
  it('malformado, formato, identificador y búsqueda inválidos tienen error explícito y no leen SQL', async () => {
    const { client, post } = await start();
    expect(
      (await post().set('Content-Type', 'application/json').send('{').expect(400)).body.code,
    ).toBe('MALFORMED_JSON');
    expect((await post().type('text').send('{}').expect(415)).body.code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
    for (const body of [null, [], {}, { vehicleId: '' }, { vehicleId: 2 }])
      await post().set('Content-Type', 'application/json').send(JSON.stringify(body)).expect(400);
    await client.get('/api/vehicles?q=a&q=b').expect(400);
    await client.get('/api/vehicles?q[x]=a').expect(400);
    expect(history).not.toHaveBeenCalled();
    expect(fleet).not.toHaveBeenCalled();
  });
  it('cuerpo exacto de 2 MiB se acepta; byte adicional y UTF-8 inválido se rechazan', async () => {
    const { post } = await start();
    const minimal = '{"vehicleId":"A"}';
    const exact = minimal.padEnd(2 * 1024 * 1024);
    await post().set('Content-Type', 'application/json').send(exact).expect(200);
    await post()
      .set('Content-Type', 'application/json')
      .send(exact + ' ')
      .expect(413);
    await post()
      .set('Content-Type', 'application/json')
      .send(Buffer.from([0xc3, 0x28]))
      .expect(400);
    expect(history).toHaveBeenCalledExactlyOnceWith('A');
  });
  it('POST comparte la cuota de lectura con los GET, después de comprobar origen y CSRF', async () => {
    const { client, post } = await start(2);
    await client.get('/api/vehicles').expect(200);
    await post().send({ vehicleId: 'A' }).expect(200);
    expect((await client.get('/api/alerts').expect(429)).body.code).toBe('RATE_LIMITED');
    expect((await post().send({ vehicleId: 'A' }).expect(429)).body.code).toBe('RATE_LIMITED');
    await client.post('/api/queries/vehicle-events').set('Origin', origin).send('{').expect(403);
    expect(history).toHaveBeenCalledOnce();
  });
  it('alertas valida URI y filtro exacto y comparte caso de uso GET/POST', async () => {
    const { client, post } = await start();
    const id = " A/%_'\u0000 ";
    const direct = await client.get('/api/alerts?vehicleId=' + encodeURIComponent(id)).expect(200);
    expect(direct.body).toEqual(
      (await post('/api/queries/alerts').send({ vehicleId: id }).expect(200)).body,
    );
    expect(alerts).toHaveBeenNthCalledWith(1, id);
    expect(alerts).toHaveBeenNthCalledWith(2, id);
    expect((await client.get('/api/alerts').expect(200)).body.overallTotal).toBe(0);
    expect(alerts).toHaveBeenLastCalledWith(undefined);
    const escaped = 'x'.repeat(12000) + '\u0000\ud800';
    await post('/api/queries/alerts').send({ vehicleId: escaped }).expect(200);
    expect(alerts).toHaveBeenLastCalledWith(escaped);
    alerts.mockClear();
    for (const query of [
      'vehicleId=',
      'vehicleId=A&vehicleId=A',
      'vehicleId=A&vehicl%65Id=A',
      'vehicleId=A' + '&'.repeat(1100) + 'vehicleId=B',
      'vehicleId[]=A',
      'vehicleId[x]=A',
      'other=A',
      'vehicleId=%',
      'vehicleId=%FF',
      'vehicleId=%ED%A0%80',
    ])
      expect((await client.get('/api/alerts?' + query).expect(400)).body.code).toBe(
        'INVALID_QUERY',
      );
    expect(alerts).not.toHaveBeenCalled();
  });
  it('POST de alertas comprueba acceso antes del parser y rechaza formatos inválidos', async () => {
    const { client, post } = await start();
    const path = '/api/queries/alerts';
    await request(app!.getHttpServer())
      .get('/api/alerts')
      .set('X-API-Key', '1'.repeat(64))
      .expect(403);
    await request(app!.getHttpServer())
      .post(path)
      .set('X-API-Key', '1'.repeat(64))
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(403);
    await client.post(path).set('Content-Type', 'application/json').send('{').expect(403);
    await client.post(path).set('Origin', origin).send('{').expect(403);
    await post(path).set('Origin', 'http://foreign.invalid').send('{').expect(403);
    await post(path).set('X-CSRF-Token', 'invalid').send('{').expect(403);
    for (const body of [null, [], {}, { vehicleId: '' }, { vehicleId: 1 }, { vehicleId: {} }])
      expect((await post(path).type('json').send(JSON.stringify(body)).expect(400)).body.code).toBe(
        'INVALID_QUERY',
      );
    const malformed = await post(path).type('json').send('{').expect(400);
    expect(malformed.headers['content-type']).toContain('application/problem+json');
    expect(malformed.body.code).toBe('MALFORMED_JSON');
    await post(path).type('text').send('{}').expect(415);
    await post(path).type('json').set('Content-Encoding', 'gzip').send('{}').expect(415);
    await post(path)
      .type('json')
      .send(Buffer.from([0xc3, 0x28]))
      .expect(400);
    expect(alerts).not.toHaveBeenCalled();
  });
  it('alertas conserva límite exacto, error SQL explícito y cuota compartida', async () => {
    const { client, post } = await start(4);
    const path = '/api/queries/alerts';
    const exact = '{"vehicleId":"A"}'.padEnd(2 * 1024 * 1024);
    await post(path).type('json').send(exact).expect(200);
    await post(path)
      .type('json')
      .send(exact + ' ')
      .expect(413);
    alerts.mockRejectedValueOnce(new Error('synthetic-private-sql-detail'));
    const failed = await post(path).send({ vehicleId: 'A' }).expect(503);
    expect(failed.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(failed.body)).not.toContain('synthetic-private-sql-detail');
    await client.get('/api/vehicles').expect(200);
    await client.get('/api/alerts').expect(429);
    await post(path).type('json').send('{').expect(429);
    await post(path).set('X-CSRF-Token', 'invalid').type('json').send('{').expect(403);
    expect(alerts).toHaveBeenCalledTimes(2);
  });
});
