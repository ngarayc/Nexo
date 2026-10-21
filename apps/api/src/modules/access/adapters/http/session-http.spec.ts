import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Controller, Get } from '@nestjs/common';
import { MemoryStore as RateMemoryStore } from 'express-rate-limit';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../../../app.module.js';
import { configureApplication } from '../../../../app.factory.js';
import { Authenticate } from '../../application/authenticate.js';
import { ACCESS_CONFIG } from './access-config.js';
import type { AccessConfig } from './access-config.js';
import { Sessions } from './sessions.js';

vi.mock('../../../../platform/database/database.service.js', () => ({
  DatabaseService: class {
    async isHealthy() {
      return true;
    }
  },
}));

// La suite mantiene los controles de sesión reales y sustituye la ingesta ajena a su alcance.
vi.mock('../../../ingestion/public.js', async () => {
  const { Module } = await import('@nestjs/common');
  class IngressStub {}
  class IngestionStubModule {}
  Module({
    providers: [
      {
        provide: IngressStub,
        useValue: {
          middleware: (_request: unknown, _response: unknown, next: () => void) => next(),
          isProducerRequest: () => false,
        },
      },
    ],
    exports: [IngressStub],
  })(IngestionStubModule);
  return { IngestionModule: IngestionStubModule, IngestionIngress: IngressStub };
});

@Controller('unclassified')
class UnclassifiedController {
  @Get()
  data() {
    return { confidential: true };
  }
}

describe('sesión HTTP con bibliotecas reales y credenciales sustituidas explícitamente', () => {
  let app: NestExpressApplication;
  const origin = 'http://localhost:8080';
  const authenticate = {
    execute: vi.fn(async ({ username, password }: { username: string; password: string }) =>
      username === 'demo' && password === 'demo'
        ? { id: 'account', username: 'demo' as const }
        : undefined,
    ),
  };

  async function start(overrides: Partial<AccessConfig> = {}) {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [UnclassifiedController],
    })
      .overrideProvider(ACCESS_CONFIG)
      .useValue({
        origin,
        secret: 'a'.repeat(64),
        demoEnabled: true,
        sessionMilliseconds: 14400000,
        maximumSessions: 32,
        loginLimit: 10,
        readLimit: 600,
        windowMilliseconds: 60000,
        ...overrides,
      })
      .overrideProvider(Authenticate)
      .useValue(authenticate)
      .compile();
    app = configureApplication(
      module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false }),
    );
    await app.init();
    return request(app.getHttpServer());
  }
  beforeEach(() => {
    authenticate.execute.mockClear();
  });
  afterEach(async () => {
    await app?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const cookieOf = (response: { headers: Record<string, unknown> }): string => {
    const header = response.headers['set-cookie'];
    if (!Array.isArray(header) || typeof header[0] !== 'string') throw new Error('Falta cookie.');
    return header[0].split(';')[0]!;
  };

  it('origen se comprueba antes del JSON; formato/tamaño antes de hash y cuotas', async () => {
    const client = await start();
    await client.post('/api/session').set('Content-Type', 'application/json').send('{').expect(403);
    await client
      .post('/api/session')
      .set('Origin', 'null')
      .send({ username: 'demo', password: 'demo' })
      .expect(403);
    await client
      .post('/api/session')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 1, password: 'demo' })
      .expect(400);
    await client
      .post('/api/session')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send(' '.repeat(4097))
      .expect(413);
    expect(authenticate.execute).not.toHaveBeenCalled();
  });

  it('emite cookie segura para loopback, regenera SID y mantiene CSRF estable', async () => {
    const client = await start();
    const first = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    const firstCookie = cookieOf(first);
    const headers = String(first.headers['set-cookie']);
    expect(
      headers.includes('HttpOnly') &&
        headers.includes('SameSite=Strict') &&
        headers.includes('Path=/'),
    ).toBe(true);
    expect(headers.includes('Domain=') || headers.includes('Secure')).toBe(false);
    const current = await client.get('/api/session').set('Cookie', firstCookie).expect(200);
    expect(current.body).toEqual(first.body);
    expect(current.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(current.body).sort()).toEqual(['csrfToken', 'expiresAt', 'user']);
    const next = await client
      .post('/api/session')
      .set('Cookie', firstCookie)
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    expect(cookieOf(next) === firstCookie).toBe(false);
    expect(next.body.csrfToken === first.body.csrfToken).toBe(false);
    await client.get('/api/session').set('Cookie', firstCookie).expect(403);
  });

  it('logout exige su CSRF y origen; invalida solo su sesión', async () => {
    const client = await start();
    const login = () =>
      client
        .post('/api/session')
        .set('Origin', origin)
        .send({ username: 'demo', password: 'demo' })
        .expect(200);
    const first = await login();
    const second = await login();
    const cookie = cookieOf(first);
    await client.delete('/api/session').set('Cookie', cookie).set('Origin', origin).expect(403);
    await client
      .delete('/api/session')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', second.body.csrfToken)
      .expect(403);
    await client
      .delete('/api/session')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', first.body.csrfToken)
      .expect(403);
    const logout = await client
      .delete('/api/session')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', first.body.csrfToken)
      .expect(204);
    expect(String(logout.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
    await client.get('/api/session').set('Cookie', cookie).expect(403);
    await client.get('/api/session').set('Cookie', cookieOf(second)).expect(200);
    await client.get('/api/session').set('X-API-Key', 'fake-producer-key').expect(403);
  });

  it('las cuatro horas son absolutas, incluso con consultas previas', async () => {
    const client = await start();
    const nativeNow = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(nativeNow);
    const first = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    const cookie = cookieOf(first);
    now.mockReturnValue(nativeNow + 14399999);
    const last = await client.get('/api/session').set('Cookie', cookie).expect(200);
    expect(last.body.expiresAt).toBe(first.body.expiresAt);
    now.mockReturnValue(nativeNow + 14400000);
    await client.get('/api/session').set('Cookie', cookie).expect(403);
  });

  it('capacidad no expulsa a otra sesión; logout libera cupo', async () => {
    const client = await start({ maximumSessions: 1 });
    const login = () =>
      client
        .post('/api/session')
        .set('Origin', origin)
        .send({ username: 'demo', password: 'demo' });
    const first = await login().expect(200);
    const cookie = cookieOf(first);
    const full = await login().expect(503);
    expect(full.body.code).toBe('SESSION_CAPACITY_REACHED');
    expect(full.headers['set-cookie']).toBeUndefined();
    await client.get('/api/session').set('Cookie', cookie).expect(200);
    await client
      .delete('/api/session')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', first.body.csrfToken)
      .expect(204);
    await login().expect(200);
  });

  it('cuota global de login y lectura; 429 con espera, pero logout y salud siguen disponibles', async () => {
    const client = await start({ loginLimit: 2, readLimit: 1 });
    const first = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'unknown', password: 'demo' })
      .expect(403);
    const limited = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'other', password: 'x' })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const cookie = cookieOf(first);
    await client.get('/api/session').set('Cookie', cookie).expect(200);
    await client.get('/api/session').set('Cookie', cookie).expect(429);
    await client.get('/api/session').expect(403);
    await client.get('/api/health').expect(200);
    await client
      .delete('/api/session')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', first.body.csrfToken)
      .expect(204);
  });

  it('fallo técnico del almacén deniega acceso sin filtrar error', async () => {
    const client = await start();
    const first = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    vi.spyOn(app.get(Sessions).store, 'get').mockImplementation((_sid, done) =>
      done(new Error('internal-secret')),
    );
    const response = await client.get('/api/session').set('Cookie', cookieOf(first)).expect(503);
    expect(JSON.stringify(response.body)).not.toContain('internal-secret');
    expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('una ruta sin clasificación se deniega incluso con sesión válida', async () => {
    const client = await start();
    const first = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
    const denied = await client.get('/api/unclassified').set('Cookie', cookieOf(first)).expect(403);
    expect(denied.body.code).toBe('ACCESS_POLICY_REQUIRED');
    expect(denied.body.confidential).toBeUndefined();
  });

  it('un fallo del limitador bloquea el login antes de verificar credenciales', async () => {
    const client = await start();
    vi.spyOn(RateMemoryStore.prototype, 'increment').mockRejectedValue(
      new Error('internal-rate-secret'),
    );
    const denied = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(503);
    expect(denied.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(authenticate.execute).not.toHaveBeenCalled();
    expect(denied.headers['set-cookie']).toBeUndefined();
  });

  it('un fallo al guardar no emite cookie ni deja una reserva admitida', async () => {
    const client = await start({ maximumSessions: 1 });
    const store = app.get(Sessions).store;
    const failure = vi
      .spyOn(store, 'set')
      .mockImplementationOnce((_sid, _data, done) => done?.(new Error('internal-save-secret')));
    const denied = await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(503);
    expect(denied.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(denied.headers['set-cookie']).toBeUndefined();
    failure.mockRestore();
    await client
      .post('/api/session')
      .set('Origin', origin)
      .send({ username: 'demo', password: 'demo' })
      .expect(200);
  });
});
