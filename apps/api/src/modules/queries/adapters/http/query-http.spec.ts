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
            alerts: async () => ({ items: [], total: 0, overallTotal: 0 }),
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
    const post = () =>
      client
        .post('/api/queries/vehicle-events')
        .set('Origin', origin)
        .set('X-CSRF-Token', logged.body.csrfToken as string);
    return { client, post };
  }
  beforeEach(() => {
    history.mockClear();
    fleet.mockClear();
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
});
