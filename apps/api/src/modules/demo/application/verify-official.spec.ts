import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { FileOfficialSources } from '../adapters/files/official-sources.js';
import { LoadOfficialFixture } from './official-fixture.js';
import type { OfficialFixture } from './official-fixture.js';
import type { EvidenceEvent, ReplayEvidence, ReplayReport } from './verification.js';
import { VerifyOfficialReplay } from './verify-official.js';

// Hechos sintéticos derivados de los oráculos entregados. No acreditan envíos HTTP.
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
let fixture: OfficialFixture;
const instanceId = randomUUID(),
  firstId = randomUUID(),
  secondId = randomUUID();
beforeAll(async () => {
  fixture = await new LoadOfficialFixture(new FileOfficialSources()).load();
});
function facts(): Mutable<ReplayEvidence> {
  const events = Object.values(fixture.detailed.history_by_vehicle_ascending)
    .flat()
    .map((id) => ({
      ...(fixture.acceptedEvents[id] as unknown as Omit<EvidenceEvent, 'extraEmpty'>),
      extraEmpty: true,
    }));
  const attempts = fixture.rows.map((row) => ({
    runId: firstId,
    lineNumber: row.lineNumber,
    batchIndex: 0,
    ingestionId: randomUUID(),
    eventId: row.eventId,
    state: 'classified',
    outcome: row.firstOutcome,
    reasonCode: row.reason,
  }));
  const receipts = attempts.map((attempt) => ({
    ingestionId: attempt.ingestionId,
    state: 'complete',
    total: 1,
    nextIndex: 1,
    requestMatches: true,
    itemIndex: 0,
    itemState: 'classified',
    inputMatches: true,
    outcome: attempt.outcome,
    reasonCode: attempt.reasonCode,
    resolvedEventId: attempt.outcome === 'rejected' ? null : attempt.eventId,
  }));
  return {
    observedAt: '2026-10-22T12:00:00.000001Z',
    environment: {
      instanceId,
      ready: true,
      softwareFingerprint: 'a'.repeat(64),
      configurationFingerprint: 'b'.repeat(64),
    },
    counts: {
      events: 20,
      vehicles: 8,
      alerts: 4,
      messages: 43,
      pendingMessages: 0,
      receipts: 24,
      activeReceipts: 0,
      failedReceipts: 0,
      runs: 1,
      attempts: 24,
    },
    runs: [
      {
        runId: firstId,
        scenarioId: firstId,
        previousRunId: null,
        instanceId,
        fixtureSha256: fixture.fixtureSha256,
        stage: 'first',
        state: 'completed',
        nextLine: 25,
        revision: 50,
        verification: 'pending',
        verificationDocument: null,
        scenarioVerification: 'pending',
        scenarioClosedAt: null,
      },
    ],
    attempts,
    receiptIds: receipts.map((receipt) => receipt.ingestionId).sort(),
    receipts,
    events,
    latest: Object.entries(fixture.detailed.latest_by_vehicle).map(([vehicleId, eventId]) => ({
      ...events.find((event) => event.eventId === eventId)!,
      status: fixture.sample.status_by_vehicle[vehicleId]!,
    })),
    alerts: fixture.detailed.overspeed_event_ids.map((id) =>
      events.find((event) => event.eventId === id)!,
    ),
    messages: [
      ...fixture.detailed.accepted_event_ids.map((eventId) => ({
        eventId,
        type: 'telemetry.accepted',
        published: true,
      })),
      ...fixture.detailed.accepted_event_ids
        .filter((id) => id !== 'E-001-00')
        .map((eventId) => ({ eventId, type: 'vehicle.updated', published: true })),
      ...fixture.detailed.overspeed_event_ids.map((eventId) => ({
        eventId,
        type: 'alert.created',
        published: true,
      })),
    ],
    jobs: { complete: true, queued: 0, active: 0 },
  };
}
const verifier = (observed: ReplayEvidence) =>
  new VerifyOfficialReplay(fixture, { read: async () => observed });
const check = (report: ReplayReport, key: string) =>
  report.checks.find((item) => item.key === key)!;
async function second(): Promise<Mutable<ReplayEvidence>> {
  const data = facts(),
    saved = await verifier(data).evaluate(firstId);
  data.runs[0]!.verification = 'conformant';
  data.runs[0]!.verificationDocument = JSON.stringify(saved);
  data.runs.push({
    ...data.runs[0]!,
    runId: secondId,
    previousRunId: firstId,
    stage: 'second',
    verification: 'pending',
    verificationDocument: null,
  });
  const additional = fixture.rows.map((row) => ({
    runId: secondId,
    lineNumber: row.lineNumber,
    batchIndex: 0,
    ingestionId: randomUUID(),
    eventId: row.eventId,
    state: 'classified',
    outcome: row.secondOutcome,
    reasonCode: row.reason,
  }));
  data.attempts.push(...additional);
  data.receipts.push(
    ...additional.map((attempt) => ({
      ingestionId: attempt.ingestionId,
      state: 'complete',
      total: 1,
      nextIndex: 1,
      requestMatches: true,
      itemIndex: 0,
      itemState: 'classified',
      inputMatches: true,
      outcome: attempt.outcome,
      reasonCode: attempt.reasonCode,
      resolvedEventId: attempt.outcome === 'rejected' ? null : attempt.eventId,
    })),
  );
  data.receiptIds = data.receipts.map((receipt) => receipt.ingestionId).sort();
  Object.assign(data.counts, { runs: 2, attempts: 48, receipts: 48 });
  return data;
}

describe('condiciones para otro recorrido exploratorio', () => {
  it('comprueba cierre y disponibilidad, sin acreditar un primer o segundo replay', async () => {
    const result = await verifier(facts()).prepareContinuation(firstId);
    expect(result.phase).toBe('preparation');
    expect(result.result).toBe('conformant');
    expect(result.checks.some((item) => item.key === 'accepted-identities')).toBe(false);
  });
  it('un recibo todavía activo bloquea aunque el inventario de jobs esté ocioso', async () => {
    const data = facts();
    data.counts.activeReceipts = 1;
    const result = await verifier(data).prepareContinuation(firstId);
    expect(result.result).toBe('inconclusive');
    expect(check(result, 'receipts-idle').state).toBe('pending');
  });
  it.each(['running', 'closed', 'fixture'] as const)(
    '%s impide continuar el escenario',
    async (cause) => {
      const data = facts();
      if (cause === 'running') data.runs[0]!.state = 'running';
      else if (cause === 'closed') data.runs[0]!.scenarioClosedAt = '2026-10-22T12:00:00Z';
      else data.runs[0]!.fixtureSha256 = 'f'.repeat(64);
      expect((await verifier(data).prepareContinuation(firstId)).result).toBe('non_conformant');
    },
  );
  it('una ejecución ausente es no comprobable y no una base disponible', async () => {
    const data = facts();
    data.runs = [];
    const result = await verifier(data).prepareContinuation(firstId);
    expect(result.result).toBe('inconclusive');
    expect(check(result, 'prior-terminal').state).toBe('unavailable');
  });
});

describe('segunda preparación después de confirmar su intención', () => {
  async function prepared() {
    const data = facts(),
      first = data.runs[0]!;
    first.verificationDocument = JSON.stringify(await verifier(data).evaluate(firstId));
    first.verification = 'conformant';
    first.revision++;
    data.runs.push({
      ...first,
      runId: secondId,
      previousRunId: firstId,
      stage: 'second',
      state: 'preparing',
      nextLine: 1,
      revision: 0,
      verification: 'pending',
      verificationDocument: null,
    });
    data.counts.runs = 2;
    return data;
  }
  it('revalida primero/oráculos/contexto y únicamente permite su segunda preparación sin intentos', async () => {
    const data = await prepared();
    expect((await verifier(data).prepareSecond(firstId, secondId)).result).toBe('conformant');
    expect((await verifier(data).prepareSecond(firstId)).result).toBe('non_conformant');
  });
  it.each(['state', 'instance', 'attempts', 'foreign'] as const)(
    '%s no se oculta como preparación propia',
    async (cause) => {
      const data = await prepared();
      if (cause === 'state') data.runs[1]!.state = 'running';
      else if (cause === 'instance') data.runs[1]!.instanceId = randomUUID();
      else if (cause === 'attempts') data.counts.attempts++;
      else data.counts.runs++;
      expect((await verifier(data).prepareSecond(firstId, secondId)).result).toBe('non_conformant');
    },
  );
});

describe('comparación oficial de datos y respuestas, sin sustituir evidencia visual', () => {
  it('primero20/2/2 exige identidades, contenido, historiales, estados y43mensajes', async () => {
    const result = await verifier(facts()).evaluate(firstId);
    expect(result.result).toBe('conformant');
    expect(result.checks.length).toBeGreaterThan(20);
    expect(result.checks.every((item) => item.state === 'matches')).toBe(true);
    expect(check(result, 'classifications').observed).toEqual({
      accepted: 20,
      duplicates: 2,
      rejected: 2,
    });
    expect(result.externalEvidence).toEqual({
      twoRenderedClients: 'not_assessed',
      pauseResume: 'not_assessed',
      ci: 'not_assessed',
      video: 'not_assessed',
    });
    expect(result.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('segundo0/22/2 conserva20/8/4,48recibos y43mensajes lógicos', async () => {
    const result = await verifier(await second()).evaluate(secondId);
    expect(result.result).toBe('conformant');
    expect(check(result, 'classifications').observed).toEqual({
      accepted: 0,
      duplicates: 22,
      rejected: 2,
    });
    expect(check(result, 'receipt-count').observed).toEqual({ total: 48, active: 0, failed: 0 });
  });
  it('la preparación admite solo la fila propia aún sin enviar y servicios listos', async () => {
    const data = facts();
    Object.keys(data.counts).forEach((key) => {
      data.counts[key as keyof typeof data.counts] = 0;
    });
    data.events = [];
    data.latest = [];
    data.alerts = [];
    data.messages = [];
    data.attempts = [];
    data.receipts = [];
    data.receiptIds = [];
    data.runs = [];
    expect((await verifier(data).prepare()).result).toBe('conformant');
    data.runs = [{ ...facts().runs[0]!, state: 'preparing', nextLine: 1 }];
    data.counts.runs = 1;
    expect((await verifier(data).prepare(firstId)).result).toBe('conformant');
    expect((await verifier(data).prepare()).result).toBe('non_conformant');
    data.counts.receipts = 1;
    data.receiptIds = [randomUUID()];
    expect((await verifier(data).prepare(firstId)).result).toBe('non_conformant');
  });
  it('antes del segundo vuelve a comprobar datos y contexto, sin confiar solo en el informe', async () => {
    const data = facts(),
      saved = await verifier(data).evaluate(firstId);
    data.runs[0]!.verification = 'conformant';
    data.runs[0]!.verificationDocument = JSON.stringify(saved);
    expect((await verifier(data).prepareSecond(firstId)).result).toBe('conformant');
    data.events[0]!.speedKph += 1;
    expect((await verifier(data).prepareSecond(firstId)).result).toBe('non_conformant');
  });
  it.each(['softwareFingerprint', 'configurationFingerprint'] as const)(
    'el segundo rechaza cambio de%s',
    async (key) => {
      const data = await second();
      data.environment[key] = 'c'.repeat(64);
      const result = await verifier(data).evaluate(secondId);
      expect(check(result, 'same-context').state).toBe('differs');
      expect(result.result).toBe('non_conformant');
    },
  );
  it.each(['eventId', 'speedKph', 'observedAt', 'extraEmpty'] as const)(
    'totales correctos con%s erróneo no son conformes',
    async (key) => {
      const data = facts();
      if (key === 'eventId') data.events[0]!.eventId = 'wrong-id';
      else if (key === 'speedKph') data.events[0]!.speedKph += 1;
      else if (key === 'observedAt') data.events[0]!.observedAt = '2026-01-01T00:00:00Z';
      else data.events[0]!.extraEmpty = false;
      expect((await verifier(data).evaluate(firstId)).result).toBe('non_conformant');
    },
  );
  it('no confunde80con81 ni el tardío con el último del vehículo', async () => {
    const data = facts();
    data.alerts[0] = data.events.find((event) => event.eventId === 'E-004-03')!;
    data.latest[0] = {
      ...data.events.find((event) => event.eventId === 'E-001-00')!,
      status: 'MOVING',
    };
    const result = await verifier(data).evaluate(firstId);
    expect(check(result, 'alerts').state).toBe('differs');
    expect(check(result, 'latest-identities').state).toBe('differs');
  });
  it('mismo conjunto con historial desordenado y notificación extra del tardío falla', async () => {
    const data = facts();
    [data.events[0], data.events[1]] = [data.events[1]!, data.events[0]!];
    data.messages.find((row) => row.type === 'vehicle.updated')!.eventId = 'E-001-00';
    const result = await verifier(data).evaluate(firstId);
    expect(check(result, 'histories').state).toBe('differs');
    expect(check(result, 'messages-vehicle.updated').state).toBe('differs');
  });
  it.each(['duplicate', 'rejected'])(
    'recibo ajeno solo%s implica interferencia sin cambiar dominio',
    async () => {
      const data = facts();
      data.receiptIds.push(randomUUID());
      data.counts.receipts++;
      const result = await verifier(data).evaluate(firstId);
      expect(check(result, 'no-foreign-receipts').state).toBe('differs');
      expect(result.result).toBe('non_conformant');
    },
  );
  it.each(['requestMatches', 'inputMatches'] as const)(
    'la respuesta correcta no oculta un cuerpo distinto:%s',
    async (key) => {
      const data = facts();
      data.receipts[0]![key] = false;
      const result = await verifier(data).evaluate(firstId);
      expect(check(result, 'line-results').state).toBe('differs');
    },
  );
  it('el motivo y la coordenada de rechazo son exactos, índice unitario0', async () => {
    const data = facts();
    data.attempts[21]!.reasonCode = 'INVALID_SPEED';
    data.attempts[22]!.batchIndex = 22;
    expect(check(await verifier(data).evaluate(firstId), 'line-results').state).toBe('differs');
  });
  it('la identidad del diario y la FK resuelta del recibo deben corresponder a su línea', async () => {
    const data = facts();
    data.attempts[0]!.eventId = 'wrong-journal-id';
    data.receipts[1]!.resolvedEventId = 'wrong-reference';
    const report = await verifier(data).evaluate(firstId);
    expect(check(report, 'domain-counts').state).toBe('matches');
    expect(check(report, 'line-results').state).toBe('differs');
    expect(report.result).toBe('non_conformant');
  });
  it('envío incierto no se suma a resultados confirmados ni se convierte en rechazo', async () => {
    const data = facts();
    data.runs[0]!.state = 'interrupted';
    data.runs[0]!.nextLine = 24;
    data.attempts[23]!.state = 'uncertain';
    data.attempts[23]!.outcome = null;
    const result = await verifier(data).evaluate(firstId);
    expect(result.result).toBe('inconclusive');
    expect(check(result, 'run-completed').state).toBe('pending');
    expect(check(result, 'classifications').observed).toEqual({
      accepted: 20,
      duplicates: 1,
      rejected: 2,
    });
  });
  it.each(['active', 'queued', 'incomplete', 'outbox', 'health'])(
    '%s sin resolver impide conformidad',
    async (cause) => {
      const data = facts();
      if (cause === 'active') data.jobs.active = 1;
      else if (cause === 'queued') data.jobs.queued = 1;
      else if (cause === 'incomplete') data.jobs.complete = false;
      else if (cause === 'outbox') data.counts.pendingMessages = 1;
      else data.environment.ready = false;
      expect((await verifier(data).evaluate(firstId)).result).toBe('inconclusive');
    },
  );
  it('no inventa ceros si falla la lectura; conserva el alcance desconocido', async () => {
    const unavailable = new VerifyOfficialReplay(fixture, {
      read: async () => {
        throw new Error('synthetic-private-marker');
      },
    });
    for (const result of [await unavailable.prepare(), await unavailable.evaluate(firstId)]) {
      expect(result.result).toBe('inconclusive');
      expect(result.observedAt).toBeNull();
      expect(result.environment).toBeNull();
      expect(result.checks[0]!.observed).toBeNull();
      expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
    }
  });
  it('origen de una ejecución no verificada tras reinicio es desconocido', async () => {
    const data = facts();
    data.environment.instanceId = randomUUID();
    expect(check(await verifier(data).evaluate(firstId), 'origin-known').state).toBe('unavailable');
  });
  it('parcial, tercera y exploratoria no son una segunda oficial conforme', async () => {
    const data = await second();
    data.runs[0]!.verification = 'inconclusive';
    data.counts.runs = 3;
    expect((await verifier(data).evaluate(secondId)).result).toBe('non_conformant');
    data.runs[1]!.stage = 'exploratory';
    expect((await verifier(data).evaluate(secondId)).result).toBe('inconclusive');
  });
  it('muestra incompleta se etiqueta no comprobable, sin truncamiento silencioso', async () => {
    const data = facts();
    data.events.pop();
    const result = await verifier(data).evaluate(firstId);
    expect(check(result, 'accepted-identities').state).toBe('unavailable');
    expect(result.result).toBe('inconclusive');
  });
  it('informe cerrado conserva instante y resultado; inspección posterior distingue cambios', async () => {
    const data = facts(),
      saved = await verifier(data).evaluate(firstId);
    data.runs[0]!.verification = 'conformant';
    data.runs[0]!.verificationDocument = JSON.stringify(saved);
    data.runs[0]!.revision++;
    expect((await verifier(data).inspect(firstId)).currentState).toBe('same');
    data.observedAt = '2026-10-22T12:01:00.000001Z';
    data.receiptIds.push(randomUUID());
    data.counts.receipts++;
    const inspected = await verifier(data).inspect(firstId);
    expect(inspected.report).toEqual(saved);
    expect(inspected.currentState).toBe('changed');
    expect(inspected.currentObservedAt).toBe(data.observedAt);
    expect(await verifier(data).evaluate(firstId)).toEqual(saved);
  });
  it('no reescribe un inconcluso aunque los recibos se hayan resuelto después', async () => {
    const data = facts();
    data.jobs.active = 1;
    const saved = await verifier(data).evaluate(firstId);
    data.runs[0]!.verification = 'inconclusive';
    data.runs[0]!.verificationDocument = JSON.stringify(saved);
    data.jobs.active = 0;
    expect((await verifier(data).inspect(firstId)).report).toEqual(saved);
    expect((await verifier(data).evaluate(firstId)).result).toBe('inconclusive');
  });
  it.each(['null', '{}', 'not-json'])(
    'informe cerrado ilegible:%s no se reconstruye como conforme',
    async (document) => {
      const data = facts();
      data.runs[0]!.verification = 'inconclusive';
      data.runs[0]!.verificationDocument = document;
      for (const result of [
        await verifier(data).evaluate(firstId),
        (await verifier(data).inspect(firstId)).report,
      ]) {
        expect(result.result).toBe('inconclusive');
        expect(check(result, 'original-result').state).toBe('unavailable');
      }
    },
  );
  it.each(['checks', 'context', 'sources', 'scenario'])(
    'cabecera histórica incompleta:%s no acredita conformidad',
    async (field) => {
      const data = facts(),
        saved = structuredClone(await verifier(data).evaluate(firstId));
      if (field === 'checks') Object.assign(saved, { checks: [] });
      else if (field === 'context') Object.assign(saved, { environment: {} });
      else if (field === 'sources') Object.assign(saved, { sources: {} });
      else Object.assign(saved, { scenarioId: randomUUID() });
      data.runs[0]!.verification = 'conformant';
      data.runs[0]!.verificationDocument = JSON.stringify(saved);
      const report = await verifier(data).evaluate(firstId);
      expect(report.result).toBe('inconclusive');
      expect(check(report, 'original-result').state).toBe('unavailable');
    },
  );
});

describe('cierre separado del escenario', () => {
  async function closedPair() {
    const data = await second();
    const saved = await verifier(data).evaluate(secondId);
    data.runs[1]!.verification = saved.result;
    data.runs[1]!.verificationDocument = JSON.stringify(saved);
    data.runs[1]!.revision++;
    return { data, saved };
  }
  it('par originalmente conforme y receptor sin cambios permiten un cierre conforme', async () => {
    const { data } = await closedPair();
    expect((await verifier(data).evaluateScenario(secondId)).result).toBe('conformant');
  });
  it('una recepción ajena posterior invalida el cierre y conserva el resultado individual original', async () => {
    const { data, saved } = await closedPair();
    data.receiptIds.push(randomUUID());
    data.counts.receipts++;
    expect((await verifier(data).evaluateScenario(secondId)).result).toBe('non_conformant');
    expect(await verifier(data).evaluate(secondId)).toEqual(saved);
  });
  it('resolver un pendiente posterior no transforma el segundo informe inconcluso en éxito del par', async () => {
    const data = await second();
    data.jobs.active = 1;
    const saved = await verifier(data).evaluate(secondId);
    data.runs[1]!.verification = saved.result;
    data.runs[1]!.verificationDocument = JSON.stringify(saved);
    data.jobs.active = 0;
    const result = await verifier(data).evaluateScenario(secondId);
    expect(result.result).toBe('inconclusive');
    expect(check(result, 'original-pair').state).toBe('unavailable');
  });
  it('un primer recorrido solo no cierra como par completo', async () => {
    const data = facts();
    const saved = await verifier(data).evaluate(firstId);
    data.runs[0]!.verification = saved.result;
    data.runs[0]!.verificationDocument = JSON.stringify(saved);
    expect((await verifier(data).evaluateScenario(firstId)).result).toBe('inconclusive');
  });
});
