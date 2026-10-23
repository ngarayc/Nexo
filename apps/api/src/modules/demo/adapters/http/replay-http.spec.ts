import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApplication } from '../../../../app.factory.js';
import { DatabaseModule } from '../../../../platform/database/database.module.js';
import { AccessModule } from '../../../access/public.js';
import { Authenticate } from '../../../access/application/authenticate.js';
import { ACCESS_CONFIG } from '../../../access/adapters/http/access-config.js';
import { IngestionIngress } from '../../../ingestion/public.js';
import { ReplayAdmissionUnknown } from '../../application/admit-command.js';
import { ReplayPreconditionsFailed } from '../../application/replay-coordinator.js';
import type { ReplayReport } from '../../application/verification.js';
import { readReplayCommand } from '../../domain/command.js';
import { DemoRuntime } from '../../demo-runtime.js';
import { ReplayController } from './replay-controller.js';

// Acceso, cuotas y parser HTTP reales. El motor/SQL se prueban en integración.
vi.mock('../../../../platform/database/database.service.js', () => ({
  DatabaseService: class {
    async isHealthy() {
      return true;
    }
  },
}));
describe('frontera HTTP del control compartido', () => {
  let app: NestExpressApplication | undefined;
  const origin = 'http://localhost:8080';
  const id = randomUUID();
  const instanceId = randomUUID();
  const command = vi.fn(async (value: unknown) => {
    const input = readReplayCommand(value);
    return {
      commandId: input.commandId,
      instanceId,
      runId: id,
      admittedControlVersion: 1,
      accepted: true,
    };
  });
  const view = vi.fn(async () => ({ instanceId, controlVersion: 0, run: null }));
  const receipt = vi.fn(async () => undefined);
  const history = vi.fn(async () => ({ items: [], nextCursor: null }));
  const detail = vi.fn<DemoRuntime['detail']>(async () => undefined);
  const inspect = vi.fn<DemoRuntime['inspect']>();
  const reset = vi.fn<DemoRuntime['reset']>(async () => ({ cleared: true }));
  async function start(demoEnabled = true) {
    const module = await Test.createTestingModule({
      imports: [AccessModule, DatabaseModule],
      controllers: [ReplayController],
      providers: [
        {
          provide: DemoRuntime,
          useValue: { command, view, receipt, history, detail, inspect, reset },
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
        demoEnabled,
        sessionMilliseconds: 14400000,
        maximumSessions: 32,
        loginLimit: 10,
        readLimit: 600,
        windowMilliseconds: 60000,
      })
      .compile();
    app = configureApplication(
      module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false }),
    );
    await app.listen(0, '127.0.0.1');
    const client = request.agent(app.getHttpServer());
    const login = async () => {
      const logged = await client
        .post('/api/session')
        .set('Origin', origin)
        .send({ username: 'demo', password: 'demo' })
        .expect(200);
      return logged.body.csrfToken as string;
    };
    const post = (csrf: string) =>
      client.post('/api/demo/replay/commands').set('Origin', origin).set('X-CSRF-Token', csrf);
    return { client, login, post };
  }
  const input = () => ({
    commandId: randomUUID(),
    instanceId,
    expectedControlVersion: 0,
    runId: null,
    action: 'start',
  });
  it('limpiar exige modo demo, sesión, origen y CSRF antes de invocar el borrado', async () => {
    const { client, login } = await start();
    const payload = { instanceId, expectedControlVersion: 0, confirmation: 'CLEAR_DEMO' };
    await client.post('/api/demo/replay/reset').set('Origin', origin).send(payload).expect(403);
    const csrf = await login();
    await client.post('/api/demo/replay/reset').set('Origin', origin).send(payload).expect(403);
    await client
      .post('/api/demo/replay/reset')
      .set('Origin', 'https://other.example')
      .set('X-CSRF-Token', csrf)
      .send(payload)
      .expect(403);
    expect(reset).not.toHaveBeenCalled();
    await client
      .post('/api/demo/replay/reset')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send(payload)
      .expect(200, { cleared: true });
    expect(reset).toHaveBeenCalledExactlyOnceWith(payload);
  });
  it('la limpieza no existe fuera del modo demo', async () => {
    const { client } = await start(false);
    await client.post('/api/demo/replay/reset').set('Origin', origin).send({}).expect(404);
    expect(reset).not.toHaveBeenCalled();
  });
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    await app?.close();
  });
  it('sesión, origen y CSRF preceden al JSON; API key no sustituye acceso al control', async () => {
    const { client, login, post } = await start();
    await request(app!.getHttpServer())
      .get('/api/demo/replay')
      .set('X-API-Key', '1'.repeat(64))
      .expect(403);
    await client.post('/api/demo/replay/commands').type('json').send('{').expect(403);
    const csrf = await login();
    await client
      .post('/api/demo/replay/commands')
      .set('Origin', origin)
      .type('json')
      .send('{')
      .expect(403);
    await client
      .post('/api/demo/replay/commands')
      .set('Origin', 'http://untrusted.invalid')
      .set('X-CSRF-Token', csrf)
      .type('json')
      .send('{')
      .expect(403);
    expect(command).not.toHaveBeenCalled();
    const accepted = await post(csrf).send(input()).expect(202);
    expect(accepted.body.accepted).toBe(true);
    expect(accepted.headers['cache-control']).toContain('no-store');
    expect(command).toHaveBeenCalledTimes(1);
  });
  it('4 KiB exactos se aceptan; byte adicional, UTF-8, JSON, formato y tipos se rechazan', async () => {
    const { login, post } = await start();
    const csrf = await login(),
      exact = JSON.stringify(input()).padEnd(4096);
    await post(csrf).type('json').send(exact).expect(202);
    await post(csrf)
      .type('json')
      .send(exact + ' ')
      .expect(413);
    // write evita que Superagent transforme Buffer en un objeto JSON válido.
    const invalidUtf8 = post(csrf).type('json');
    invalidUtf8.write(Buffer.from([0xc3, 0x28]));
    await invalidUtf8.expect(400);
    await post(csrf).type('json').send('{').expect(400);
    await post(csrf).type('text').send('{}').expect(415);
    await post(csrf)
      .send({ ...input(), intervalMs: '750' })
      .expect(400);
    await post(csrf)
      .send({ ...input(), target: 'http://untrusted.invalid' })
      .expect(400);
    expect(command).toHaveBeenCalledTimes(3); // Dos formas inválidas llegan al parser del comando.
  });
  it('modo demo deshabilitado devuelve404 antes del acceso/parser y no invoca el motor', async () => {
    const { client } = await start(false);
    await client.get('/api/demo/replay').expect(404);
    await client.post('/api/demo/replay/commands').type('json').send('{').expect(404);
    expect(view).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });
  it('selectores excluyentes, duplicados, límites y cursores acotados no consultan el diario', async () => {
    const { client, login } = await start();
    await login();
    for (const query of [
      '?runId=x',
      '?runId=' + id + '&view=history',
      '?runId=' + id + '&runId=' + id,
      '?view=history&limit=0',
      '?view=history&limit=101',
      '?view=history&limit=2.5',
      '?view=history&limit=020',
      '?view=history&cursor=' + 'a'.repeat(513),
      '?commandId=' + id,
      '?extra=true',
    ])
      await client.get('/api/demo/replay' + query).expect(400);
    expect(view).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
    await client.get('/api/demo/replay?view=history').expect(200);
    expect(history).toHaveBeenCalledExactlyOnceWith(20, undefined);
  });
  it('recibo ausente y ejecución ausente difieren de admisión desconocida; nunca emite202 por fallo', async () => {
    const { client, login, post } = await start();
    const csrf = await login();
    const absent = await client
      .get(`/api/demo/replay?commandId=${id}&instanceId=${instanceId}`)
      .expect(404);
    expect(absent.body.code).toBe('COMMAND_RECEIPT_UNAVAILABLE');
    expect((await client.get('/api/demo/replay?runId=' + id).expect(404)).body.code).toBe(
      'REPLAY_NOT_FOUND',
    );
    command.mockRejectedValueOnce(new ReplayAdmissionUnknown());
    expect((await post(csrf).send(input()).expect(503)).body).toMatchObject({
      code: 'REPLAY_ADMISSION_UNKNOWN',
      admission: 'unknown',
    });
  });
  it('cuota de60 comandos se comparte entre sesiones y precede al parser', async () => {
    const { client, login, post } = await start();
    const csrf = await login();
    for (let index = 0; index < 60; index++) await post(csrf).send(input()).expect(202);
    await login(); // Regenera sesión; no reinicia la cuota de la cuenta demo.
    const fresh = (await client.get('/api/session').expect(200)).body.csrfToken as string;
    expect((await post(fresh).type('json').send('{').expect(429)).body.code).toBe('RATE_LIMITED');
    expect(command).toHaveBeenCalledTimes(60);
    await client.get('/api/demo/replay').expect(200); // Lectura tiene presupuesto independiente.
  });
  it('expone solo evidencia vigente en informes históricos y errores sin reescribir el documento', async () => {
    const date = '2026-01-01T00:00:00Z';
    const externalEvidence = {
      twoRenderedClients: 'not_assessed' as const,
      pauseResume: 'not_assessed' as const,
      ci: 'not_assessed' as const,
    };
    const report: ReplayReport = {
      version: 1,
      scope: 'data-and-replays',
      phase: 'first',
      result: 'inconclusive',
      observedAt: null,
      attemptedAt: date,
      runId: id,
      scenarioId: id,
      runRevision: 1,
      environment: null,
      sources: {},
      snapshotFingerprint: null,
      checks: [],
      externalEvidence: {
        ...externalEvidence,
        retiredEvidence: 'not_assessed',
      } as typeof externalEvidence,
    };
    const document = JSON.stringify(report);
    detail.mockResolvedValueOnce({
      run: {
        runId: id,
        scenarioId: id,
        previousRunId: null,
        instanceId,
        fixtureSha256: 'a'.repeat(64),
        stage: 'first',
        intervalMs: 750,
        state: 'interrupted',
        nextLine: 1,
        revision: 1,
        verification: 'inconclusive',
        verificationDocument: document,
        scenarioVerification: 'inconclusive',
        scenarioDocument: document,
        scenarioClosedAt: date,
        closeCode: null,
        intention: null,
        createdAt: date,
        updatedAt: date,
      },
      attempts: [],
      progress: {
        total: 24,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
        classified: 0,
        inFlight: 0,
        uncertain: 0,
        technicalFailure: 0,
        unattempted: 24,
        nextLine: 1,
      },
    });
    inspect.mockResolvedValueOnce({ report, currentState: 'changed', currentObservedAt: date });
    const { client, login, post } = await start();
    const csrf = await login();
    const result = await client.get('/api/demo/replay?runId=' + id).expect(200);
    expect(result.body.scenario.report.externalEvidence).toEqual(externalEvidence);
    expect(result.body.inspection.report.externalEvidence).toEqual(externalEvidence);
    expect(JSON.stringify(report)).toBe(document);
    command.mockRejectedValueOnce(new ReplayPreconditionsFailed(report));
    const failed = await post(csrf).send(input()).expect(409);
    expect(failed.body.report.externalEvidence).toEqual(externalEvidence);
    expect(JSON.stringify(report)).toBe(document);
  });
});
