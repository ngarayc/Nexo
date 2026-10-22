import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { LoopbackReplayProducer, readReplayIngestionResponse } from './replay-producer.js';
const ingestionId = randomUUID(),
  eventId = 'E-007-03';
const line = { body: '{"events":[{"eventId":"E-007-03","speedKph":"invalid"}]}', eventId };
const key = 'c'.repeat(64);
const reply = (outcome = 'accepted') => ({
  ingestionId,
  revision: 1,
  complete: true,
  total: 1,
  accepted: outcome === 'accepted' ? 1 : 0,
  duplicates: outcome === 'duplicate' ? 1 : 0,
  rejected: outcome === 'rejected' ? 1 : 0,
  results: [{ index: 0, eventId, outcome }],
  errors: outcome === 'rejected' ? [{ index: 0, eventId, reason: 'INVALID_SPEED' }] : [],
  pendingIndexes: [],
  failedIndexes: [],
  failures: [],
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
describe('respuesta final estricta, independiente del resultado esperado por oráculos', () => {
  it.each(['accepted', 'duplicate', 'rejected'])(
    'confirma%s solo con recibo/counters/identidad coherentes',
    (outcome) => {
      expect(readReplayIngestionResponse(200, reply(outcome), ingestionId, eventId)).toEqual({
        state: 'classified',
        outcome,
        reasonCode: outcome === 'rejected' ? 'INVALID_SPEED' : null,
      });
    },
  );
  it.each([
    { ingestionId: randomUUID() },
    { accepted: '1' },
    { total: 2 },
    { revision: -1 },
    { complete: false },
    { pendingIndexes: [0] },
    { failedIndexes: [0] },
    { results: [{ index: 22, eventId, outcome: 'accepted' }] },
    { results: [{ index: 0, eventId: 'wrong', outcome: 'accepted' }] },
    { errors: [{ index: 0, reason: 'unexpected' }] },
  ])('una respuesta incompleta o contradictoria no se clasifica #%#', (change) => {
    expect(
      readReplayIngestionResponse(200, { ...reply(), ...change }, ingestionId, eventId).state,
    ).toBe('uncertain');
  });
  it('503pendiente y500técnico no son rechazos de dominio', () => {
    const pending = {
      ...reply(),
      complete: false,
      accepted: 0,
      results: [],
      admission: 'admitted',
      resultsAvailable: true,
      code: 'INGESTION_RESULT_PENDING',
      pendingIndexes: [0],
    };
    expect(readReplayIngestionResponse(503, pending, ingestionId, eventId)).toMatchObject({
      state: 'uncertain',
      closeCode: 'RESPONSE_PENDING',
    });
    expect(
      readReplayIngestionResponse(
        500,
        { ...pending, code: 'INGESTION_PROCESSING_FAILED', failedIndexes: [0] },
        ingestionId,
        eventId,
      ),
    ).toMatchObject({ state: 'technical_failure', closeCode: 'PROCESSING_FAILED' });
  });
  it('solo una negativa explícita y compatible prueba no admisión', () => {
    const body = {
      code: 'INGESTION_CAPACITY_EXCEEDED',
      admission: 'not_admitted',
      resultsAvailable: false,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      errors: [],
    };
    expect(readReplayIngestionResponse(503, body, ingestionId, eventId)).toMatchObject({
      state: 'technical_failure',
      closeCode: 'NOT_ADMITTED',
    });
    expect(
      readReplayIngestionResponse(503, { ...body, admission: 'unknown' }, ingestionId, eventId)
        .state,
    ).toBe('uncertain');
  });
  it.each(['admitted', 'unknown'] as const)(
    'estado del recibo no consultable conserva admisión%s sin inventar clasificación',
    (admission) => {
      const result = readReplayIngestionResponse(
        503,
        { code: 'INGESTION_STATUS_UNAVAILABLE', ingestionId, admission, resultsAvailable: false },
        ingestionId,
        eventId,
      );
      expect(result).toMatchObject({ state: 'uncertain', closeCode: 'RESPONSE_PENDING' });
      if (result.state !== 'classified')
        expect(JSON.parse(result.diagnosticDocument).admission).toBe(admission);
    },
  );
});
describe('petición loopback única, cuerpo original y clave solo servidor', () => {
  it('destino/cabeceras fijos, sin redirección y sin transformar inválidos', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(reply('rejected')));
    const sender = new LoopbackReplayProducer(3000, key, request);
    expect(await sender.send(line, ingestionId, new AbortController().signal)).toMatchObject({
      state: 'classified',
      outcome: 'rejected',
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/api/events/batch');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      body: line.body,
      headers: {
        'X-API-Key': key,
        'Idempotency-Key': ingestionId,
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.stringify(sender)).not.toContain(key);
  });
  it('pérdida de respuesta detiene con incertidumbre, no reenvía y no propaga secretos', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(key));
    const result = await new LoopbackReplayProducer(3000, key, request).send(
      line,
      ingestionId,
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ state: 'uncertain', closeCode: 'TRANSPORT_UNCERTAIN' });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it.each([
    new Response('<private-marker>', { status: 200 }),
    new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(16385), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ])('cuerpo no compatible no se archiva ni se clasifica', async (received) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(received);
    const result = await new LoopbackReplayProducer(3000, key, request).send(
      line,
      ingestionId,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ state: 'uncertain', closeCode: 'RESPONSE_INVALID' });
    expect(JSON.stringify(result)).not.toContain('private-marker');
    expect(request).toHaveBeenCalledOnce();
  });
});
