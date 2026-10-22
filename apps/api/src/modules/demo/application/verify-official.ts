import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { terminalReplay } from '../domain/replay.js';
import type { OfficialFixture } from './official-fixture.js';
import { replayEnvironmentValid } from './verification.js';
import type {
  CheckState,
  EvidenceEvent,
  EvidenceRun,
  ReadReplayEvidence,
  ReplayEnvironment,
  ReplayEvidence,
  ReplayReport,
  ReplayInspection,
  VerificationCheck,
} from './verification.js';

class Checks {
  readonly items: VerificationCheck[] = [];
  add(
    key: string,
    label: string,
    source: string,
    expected: unknown,
    observed: unknown,
    mode?: 'pending' | 'unavailable',
  ): void {
    const state: CheckState =
      mode ?? (isDeepStrictEqual(expected, observed) ? 'matches' : 'differs');
    this.items.push(Object.freeze({ key, label, source, expected, observed, state }));
  }
}
const sorted = (values: readonly string[]) => [...values].sort();
const material = (environment: ReplayEnvironment) => ({
  softwareFingerprint: environment.softwareFingerprint,
  configurationFingerprint: environment.configurationFingerprint,
});
const declared = (event: EvidenceEvent) => ({
  eventId: event.eventId,
  vehicleId: event.vehicleId,
  observedAt: event.observedAt,
  latitude: event.latitude,
  longitude: event.longitude,
  speedKph: event.speedKph,
  ignitionOn: event.ignitionOn,
});

export class VerifyOfficialReplay {
  constructor(
    private readonly fixture: OfficialFixture,
    private readonly evidence: ReadReplayEvidence,
  ) {}

  async prepare(preparingRunId?: string): Promise<ReplayReport> {
    try {
      const facts = await this.evidence.read(preparingRunId),
        checks = new Checks();
      this.ready(facts, checks);
      checks.add(
        'empty-domain',
        'Base de telemetría limpia',
        'snapshot SQL coherente',
        { events: 0, vehicles: 0, alerts: 0, messages: 0, receipts: 0, attempts: 0 },
        {
          events: facts.counts.events,
          vehicles: facts.counts.vehicles,
          alerts: facts.counts.alerts,
          messages: facts.counts.messages,
          receipts: facts.counts.receipts,
          attempts: facts.counts.attempts,
        },
      );
      checks.add(
        'initial-journal',
        'Sin reproducciones anteriores',
        'replay_runs',
        preparingRunId === undefined ? 0 : 1,
        facts.counts.runs,
      );
      if (preparingRunId !== undefined) {
        const run = facts.runs.find((item) => item.runId === preparingRunId);
        checks.add(
          'preparation-run',
          'Ejecución preparada sin envíos',
          'replay_runs',
          {
            stage: 'first',
            state: 'preparing',
            nextLine: 1,
            previousRunId: null,
            scenarioId: preparingRunId,
            fixtureSha256: this.fixture.fixtureSha256,
          },
          run
            ? {
                stage: run.stage,
                state: run.state,
                nextLine: run.nextLine,
                previousRunId: run.previousRunId,
                scenarioId: run.scenarioId,
                fixtureSha256: run.fixtureSha256,
              }
            : null,
        );
      }
      return this.report('preparation', facts, preparingRunId ?? null, checks);
    } catch {
      return this.unavailable('preparation', preparingRunId ?? null);
    }
  }

  async prepareSecond(firstRunId: string, preparingRunId?: string): Promise<ReplayReport> {
    try {
      const facts = await this.evidence.read(preparingRunId ?? firstRunId),
        checks = this.compare(facts, firstRunId, preparingRunId);
      const first = facts.runs.find((run) => run.runId === firstRunId),
        saved = first ? this.stored(first) : undefined;
      checks.add(
        'first-closed',
        'Primera reproducción completa y verificada',
        'replay_runs + informe conservado',
        {
          stage: 'first',
          state: 'completed',
          verification: 'conformant',
          scenarioClosedAt: null,
          reportResult: 'conformant',
        },
        first
          ? {
              stage: first.stage,
              state: first.state,
              verification: first.verification,
              scenarioClosedAt: first.scenarioClosedAt,
              reportResult: saved?.result ?? null,
            }
          : null,
      );
      checks.add(
        'same-context',
        'Código y configuración del receptor conservados',
        'informe primero + contexto actual',
        saved?.environment ? material(saved.environment) : null,
        material(facts.environment),
        saved?.environment ? undefined : 'unavailable',
      );
      if (preparingRunId !== undefined) {
        const preparing = facts.runs.find((item) => item.runId === preparingRunId);
        checks.add(
          'preparing-second',
          'Segunda ejecución preparada sin envíos',
          'replay_runs',
          {
            stage: 'second',
            state: 'preparing',
            nextLine: 1,
            previousRunId: firstRunId,
            scenarioId: firstRunId,
            fixtureSha256: this.fixture.fixtureSha256,
            instanceId: facts.environment.instanceId,
            verification: 'pending',
          },
          preparing
            ? {
                stage: preparing.stage,
                state: preparing.state,
                nextLine: preparing.nextLine,
                previousRunId: preparing.previousRunId,
                scenarioId: preparing.scenarioId,
                fixtureSha256: preparing.fixtureSha256,
                instanceId: preparing.instanceId,
                verification: preparing.verification,
              }
            : null,
          preparing ? undefined : 'unavailable',
        );
        checks.add(
          'preparing-second-attempts',
          'Sin intentos adicionales antes de iniciar',
          'replay_attempts',
          { total: 24, preparing: 0 },
          {
            total: facts.counts.attempts,
            preparing: facts.attempts.filter((item) => item.runId === preparingRunId).length,
          },
        );
      }
      return this.report('preparation', facts, firstRunId, checks);
    } catch {
      return this.unavailable('preparation', firstRunId);
    }
  }

  async evaluate(runId: string): Promise<ReplayReport> {
    try {
      return this.observedReport(await this.evidence.read(runId), runId);
    } catch {
      return this.unavailable('first', runId);
    }
  }

  // El cierre del escenario reobserva el receptor sin reescribir ninguno de
  // los dos informes individuales. Un resultado original inconcluso no mejora.
  async evaluateScenario(runId: string): Promise<ReplayReport> {
    try {
      const facts = await this.evidence.read(runId),
        checks = this.compare(facts, runId);
      const run = facts.runs.find((item) => item.runId === runId);
      const root = run && facts.runs.find((item) => item.runId === run.scenarioId);
      const original = {
        first: root ? (this.stored(root)?.result ?? null) : null,
        second: run?.stage === 'second' ? (this.stored(run)?.result ?? null) : null,
      };
      const unavailable = Object.values(original).some(
        (value) => value === null || value === 'inconclusive',
      );
      checks.add(
        'original-pair',
        'Resultados originales del par conservados',
        'informes individuales inmutables',
        { first: 'conformant', second: 'conformant' },
        original,
        Object.values(original).includes('non_conformant')
          ? undefined
          : unavailable
            ? 'unavailable'
            : undefined,
      );
      return this.report(run?.stage === 'second' ? 'second' : 'first', facts, runId, checks);
    } catch {
      return this.unavailable('second', runId);
    }
  }

  // Solo habilita otro recorrido exploratorio tras un cierre conocido. No
  // compara el dominio como un primer/segundo replay ni acredita el par oficial.
  async prepareContinuation(runId: string): Promise<ReplayReport> {
    try {
      const facts = await this.evidence.read(runId),
        checks = new Checks();
      this.ready(facts, checks);
      const run = facts.runs.find((item) => item.runId === runId);
      const root = run && facts.runs.find((item) => item.runId === run.scenarioId);
      checks.add(
        'prior-terminal',
        'Recorrido anterior cerrado',
        'replay_runs',
        true,
        run ? terminalReplay(run.state) : null,
        run ? undefined : 'unavailable',
      );
      checks.add(
        'scenario-open',
        'Escenario disponible para recorrido exploratorio',
        'replay_runs',
        {
          stage: 'first',
          verification: 'pending',
          closedAt: null,
          fixtureSha256: this.fixture.fixtureSha256,
        },
        root
          ? {
              stage: root.stage,
              verification: root.scenarioVerification,
              closedAt: root.scenarioClosedAt,
              fixtureSha256: root.fixtureSha256,
            }
          : null,
        root ? undefined : 'unavailable',
      );
      checks.add(
        'receipts-idle',
        'Sin recepciones anteriores pendientes',
        'ingestion_batches',
        0,
        facts.counts.activeReceipts,
        facts.counts.activeReceipts > 0 ? 'pending' : undefined,
      );
      return this.report('preparation', facts, runId, checks);
    } catch {
      return this.unavailable('preparation', runId);
    }
  }

  async inspect(runId: string): Promise<ReplayInspection> {
    try {
      const facts = await this.evidence.read(runId);
      const report = this.observedReport(facts, runId);
      const fingerprint = this.fingerprint(facts);
      const complete =
        facts.events.length === facts.counts.events &&
        facts.latest.length === facts.counts.vehicles &&
        facts.alerts.length === facts.counts.alerts &&
        facts.messages.length === facts.counts.messages &&
        facts.receiptIds.length === facts.counts.receipts;
      return {
        report,
        currentState:
          !facts.environment.ready || report.snapshotFingerprint === null
            ? 'unavailable'
            : report.snapshotFingerprint !== fingerprint
              ? 'changed'
              : complete
                ? 'same'
                : 'unavailable',
        currentObservedAt: facts.observedAt,
      };
    } catch {
      return {
        report: this.unavailable('first', runId),
        currentState: 'unavailable',
        currentObservedAt: null,
      };
    }
  }

  private observedReport(facts: ReplayEvidence, runId: string): ReplayReport {
    const run = facts.runs.find((item) => item.runId === runId),
      phase = run?.stage === 'second' ? 'second' : 'first';
    if (run && run.verification !== 'pending') {
      const saved = this.stored(run);
      if (saved) return saved;
      const checks = new Checks();
      checks.add(
        'original-result',
        'Resultado original sin reconstrucción retrospectiva',
        'diario de ejecución',
        run.verification,
        null,
        'unavailable',
      );
      return this.report(phase, facts, runId, checks);
    }
    return this.report(phase, facts, runId, this.compare(facts, runId));
  }

  private ready(facts: ReplayEvidence, checks: Checks): void {
    checks.add(
      'service-ready',
      'Servicios disponibles y esquema preparado',
      'salud de aplicación + snapshot SQL',
      true,
      facts.environment.ready,
      facts.environment.ready ? undefined : 'unavailable',
    );
    checks.add(
      'queue-inventory',
      'Lectura completa de trabajos de ingesta',
      'API pública pg-boss, misma transacción',
      true,
      facts.jobs.complete,
      facts.jobs.complete ? undefined : 'unavailable',
    );
    checks.add(
      'queue-idle',
      'Sin trabajo de ingesta pendiente o activo',
      'API pública pg-boss',
      { queued: 0, active: 0 },
      { queued: facts.jobs.queued, active: facts.jobs.active },
      !facts.jobs.complete
        ? 'unavailable'
        : facts.jobs.queued + facts.jobs.active > 0
          ? 'pending'
          : undefined,
    );
    checks.add(
      'outbox-drained',
      'Cambios de dominio publicados',
      'outbox_messages',
      0,
      facts.counts.pendingMessages,
      facts.counts.pendingMessages > 0 ? 'pending' : undefined,
    );
  }

  private compare(facts: ReplayEvidence, runId: string, preparingSecondId?: string): Checks {
    const checks = new Checks(),
      current = facts.runs.find((run) => run.runId === runId);
    this.ready(facts, checks);
    if (!current || current.stage === 'exploratory') {
      checks.add(
        'official-run',
        'Ejecución perteneciente al par oficial',
        'replay_runs',
        'first o second',
        current?.stage ?? null,
        'unavailable',
      );
      return checks;
    }
    const second = current.stage === 'second',
      root = facts.runs.find((run) => run.runId === current.scenarioId);
    const expectedRuns = second
      ? [root, current].filter((run): run is EvidenceRun => run !== undefined)
      : [current];
    const selected = facts.attempts.filter((attempt) => attempt.runId === current.runId);
    const complete =
      current.state === 'completed' &&
      selected.length === 24 &&
      selected.every((attempt) => attempt.state === 'classified');
    const mode = complete ? undefined : 'pending';
    checks.add(
      'run-completed',
      '24 resultados confirmados',
      'replay_runs + replay_attempts',
      { state: 'completed', nextLine: 25, classified: 24 },
      {
        state: current.state,
        nextLine: current.nextLine,
        classified: selected.filter((attempt) => attempt.state === 'classified').length,
      },
      mode,
    );
    checks.add(
      'scenario-runs',
      'Solo las ejecuciones previstas del escenario',
      'replay_runs',
      second || preparingSecondId !== undefined ? 2 : 1,
      facts.counts.runs,
    );
    checks.add(
      'fixture-hash',
      'Datos originales de entrada',
      'replay_runs + SHA-256',
      expectedRuns.map(() => this.fixture.fixtureSha256),
      expectedRuns.map((run) => run.fixtureSha256),
    );
    const origin =
      this.stored(current)?.environment ??
      (current.instanceId === facts.environment.instanceId ? facts.environment : null);
    checks.add(
      'origin-known',
      'Contexto de origen comprobable',
      'instancia de API o informe conservado',
      true,
      origin !== null,
      origin ? mode : 'unavailable',
    );
    if (second) {
      checks.add(
        'second-link',
        'Segunda ejecución vinculada a la primera conforme',
        'replay_runs',
        { previousRunId: current.scenarioId, firstStage: 'first', firstResult: 'conformant' },
        {
          previousRunId: current.previousRunId,
          firstStage: root?.stage ?? null,
          firstResult: root?.verification ?? null,
        },
      );
      const firstReport = root ? this.stored(root) : undefined;
      checks.add(
        'same-context',
        'Contexto conservado entre reproducciones',
        'informe primero + contexto actual',
        firstReport?.environment ? material(firstReport.environment) : null,
        material(facts.environment),
        firstReport?.environment ? undefined : 'unavailable',
      );
    }
    const outcomes = {
      accepted: selected.filter((row) => row.state === 'classified' && row.outcome === 'accepted')
        .length,
      duplicates: selected.filter(
        (row) => row.state === 'classified' && row.outcome === 'duplicate',
      ).length,
      rejected: selected.filter((row) => row.state === 'classified' && row.outcome === 'rejected')
        .length,
    };
    const target = second
      ? this.fixture.detailed.second_run_without_reset
      : this.fixture.detailed.first_run;
    checks.add(
      'classifications',
      'Aceptados, duplicados y rechazados',
      'diario de respuestas confirmadas',
      { accepted: target.accepted, duplicates: target.duplicates, rejected: target.rejected },
      outcomes,
      mode,
    );
    const expectedAttemptCount = second ? 48 : 24;
    checks.add(
      'attempts-complete',
      'Líneas del par sin duplicar intentos',
      'replay_attempts',
      expectedAttemptCount,
      facts.counts.attempts,
      mode,
    );
    const expectedIds = new Set(facts.attempts.map((attempt) => attempt.ingestionId));
    const foreign = facts.receiptIds.filter((id) => !expectedIds.has(id));
    checks.add(
      'no-foreign-receipts',
      'Sin recepciones ajenas, incluso duplicadas o inválidas',
      'ingestion_batches frente a intenciones',
      [],
      foreign,
    );
    checks.add(
      'receipt-count',
      'Recepciones previstas y completas',
      'ingestion_batches',
      { total: expectedAttemptCount, active: 0, failed: 0 },
      {
        total: facts.counts.receipts,
        active: facts.counts.activeReceipts,
        failed: facts.counts.failedReceipts,
      },
      mode,
    );
    checks.add(
      'receipt-identities',
      'Mismos identificadores de envío y recepción',
      'diario + ingestion_batches',
      sorted([...expectedIds]),
      sorted(facts.receiptIds),
      mode,
    );
    const rowsMatch = expectedRuns.every((run) => {
      const attempts = facts.attempts.filter((attempt) => attempt.runId === run.runId);
      return (
        attempts.length === 24 &&
        attempts.every((attempt, index) => {
          const row = this.fixture.rows[index],
            receipts = facts.receipts.filter(
              (receipt) => receipt.ingestionId === attempt.ingestionId,
            );
          const outcome = run.stage === 'second' ? row?.secondOutcome : row?.firstOutcome;
          const receipt = receipts[0];
          return (
            row !== undefined &&
            attempt.lineNumber === row.lineNumber &&
            attempt.eventId === row.eventId &&
            attempt.batchIndex === 0 &&
            attempt.state === 'classified' &&
            attempt.outcome === outcome &&
            attempt.reasonCode === row.reason &&
            receipts.length === 1 &&
            receipt !== undefined &&
            receipt.state === 'complete' &&
            receipt.total === 1 &&
            receipt.nextIndex === 1 &&
            receipt.itemIndex === 0 &&
            receipt.itemState === 'classified' &&
            receipt.requestMatches &&
            receipt.inputMatches === true &&
            receipt.outcome === outcome &&
            receipt.reasonCode === row.reason &&
            receipt.resolvedEventId === (outcome === 'rejected' ? null : row.eventId)
          );
        })
      );
    });
    checks.add(
      'line-results',
      'Contenido y resultado de cada línea coinciden',
      'fixture original + oráculos + diario/recibos',
      true,
      rowsMatch,
      mode,
    );
    checks.add(
      'domain-counts',
      'Eventos, vehículos y alertas conservados',
      'snapshot SQL',
      {
        events:
          target === this.fixture.detailed.first_run
            ? target.accepted
            : this.fixture.detailed.second_run_without_reset.persisted_events,
        vehicles: target.vehicles,
        alerts: target.alerts,
      },
      { events: facts.counts.events, vehicles: facts.counts.vehicles, alerts: facts.counts.alerts },
      mode,
    );
    const eventSampleComplete = facts.events.length === facts.counts.events;
    const eventMode = !eventSampleComplete ? 'unavailable' : mode;
    checks.add(
      'accepted-identities',
      'Identidades de todos los eventos aceptados',
      'telemetry_events + oráculo detallado',
      sorted(this.fixture.detailed.accepted_event_ids),
      sorted(facts.events.map((event) => event.eventId)),
      eventMode,
    );
    checks.add(
      'accepted-content',
      'Datos declarados de cada observación',
      'telemetry_events + fixture original',
      this.fixture.acceptedEvents,
      Object.fromEntries(facts.events.map((event) => [event.eventId, declared(event)])),
      eventMode,
    );
    checks.add(
      'accepted-extras',
      'Sin campos añadidos al contenido original',
      'telemetry_events',
      true,
      facts.events.every((event) => event.extraEmpty),
      eventMode,
    );
    checks.add(
      'latest-identities',
      'Último evento correcto por vehículo',
      'vehicle_latest + oráculo',
      this.fixture.detailed.latest_by_vehicle,
      Object.fromEntries(facts.latest.map((event) => [event.vehicleId, event.eventId])),
      facts.latest.length === facts.counts.vehicles ? mode : 'unavailable',
    );
    checks.add(
      'latest-states',
      'Estados de los ocho vehículos',
      'datos persistidos + oráculo de estados',
      this.fixture.sample.status_by_vehicle,
      Object.fromEntries(facts.latest.map((event) => [event.vehicleId, event.status])),
      facts.latest.length === facts.counts.vehicles ? mode : 'unavailable',
    );
    const histories: Record<string, string[]> = {};
    for (const event of facts.events) (histories[event.vehicleId] ??= []).push(event.eventId);
    checks.add(
      'histories',
      'Historiales completos en orden temporal',
      'telemetry_events ordenado + oráculo detallado',
      this.fixture.detailed.history_by_vehicle_ascending,
      histories,
      eventMode,
    );
    checks.add(
      'alerts',
      'Cuatro alertas, tardío y umbral80/81',
      'alerts + oráculo detallado',
      sorted(this.fixture.detailed.overspeed_event_ids),
      sorted(facts.alerts.map((alert) => alert.eventId)),
      facts.alerts.length === facts.counts.alerts ? mode : 'unavailable',
    );
    checks.add(
      'message-count',
      '43 mensajes lógicos; ninguno nuevo en la repetición',
      'outbox_messages',
      43,
      facts.counts.messages,
      mode,
    );
    for (const [type, ids] of Object.entries({
      'telemetry.accepted': this.fixture.detailed.accepted_event_ids,
      'vehicle.updated': this.fixture.detailed.accepted_event_ids.filter((id) => id !== 'E-001-00'),
      'alert.created': this.fixture.detailed.overspeed_event_ids,
    }))
      checks.add(
        'messages-' + type,
        'Identidades de ' + type,
        'outbox_messages',
        sorted(ids),
        sorted(
          facts.messages
            .filter((message) => message.type === type)
            .map((message) => message.eventId),
        ),
        facts.messages.length === facts.counts.messages ? mode : 'unavailable',
      );
    return checks;
  }

  private stored(run: EvidenceRun): ReplayReport | undefined {
    if (!run.verificationDocument) return undefined;
    try {
      const value = JSON.parse(run.verificationDocument) as ReplayReport;
      if (
        value === null ||
        typeof value !== 'object' ||
        value.version !== 1 ||
        value.scope !== 'data-and-replays' ||
        value.runId !== run.runId ||
        value.scenarioId !== run.scenarioId ||
        value.phase !== (run.stage === 'second' ? 'second' : 'first') ||
        value.result !== run.verification ||
        !Array.isArray(value.checks) ||
        value.checks.length === 0 ||
        value.checks.some(
          (check) =>
            check === null ||
            typeof check !== 'object' ||
            typeof check.key !== 'string' ||
            typeof check.label !== 'string' ||
            typeof check.source !== 'string' ||
            !['matches', 'differs', 'pending', 'unavailable'].includes(check.state),
        ) ||
        value.result !==
          (value.checks.some((check) => check.state === 'differs')
            ? 'non_conformant'
            : value.checks.some((check) => check.state !== 'matches')
              ? 'inconclusive'
              : 'conformant') ||
        !(value.environment === null || replayEnvironmentValid(value.environment)) ||
        (value.result === 'conformant' &&
          (value.environment === null || value.snapshotFingerprint === null)) ||
        typeof value.attemptedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.attemptedAt)) ||
        !(
          value.observedAt === null ||
          (typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)))
        ) ||
        !(
          value.snapshotFingerprint === null ||
          (typeof value.snapshotFingerprint === 'string' &&
            /^[a-f0-9]{64}$/.test(value.snapshotFingerprint))
        ) ||
        !isDeepStrictEqual(value.sources, this.fixture.hashes)
      )
        return undefined;
      return value;
    } catch {
      return undefined;
    }
  }
  private fingerprint(facts: ReplayEvidence): string {
    const { runs: _runs, attempts: _attempts, ...counts } = facts.counts;
    void _runs;
    void _attempts;
    return createHash('sha256')
      .update(
        JSON.stringify({
          counts,
          context: material(facts.environment),
          jobs: facts.jobs,
          receiptIds: facts.receiptIds,
          receipts: facts.receipts,
          events: facts.events,
          latest: facts.latest,
          alerts: facts.alerts,
          messages: facts.messages,
        }),
      )
      .digest('hex');
  }
  private report(
    phase: ReplayReport['phase'],
    facts: ReplayEvidence | null,
    runId: string | null,
    checks: Checks,
  ): ReplayReport {
    const run = facts?.runs.find((item) => item.runId === runId);
    const result = checks.items.some((check) => check.state === 'differs')
      ? 'non_conformant'
      : checks.items.some((check) => check.state !== 'matches')
        ? 'inconclusive'
        : 'conformant';
    return Object.freeze({
      version: 1,
      scope: 'data-and-replays',
      phase,
      result,
      observedAt: facts?.observedAt ?? null,
      attemptedAt: new Date().toISOString(),
      runId,
      scenarioId: run?.scenarioId ?? null,
      runRevision: run?.revision ?? null,
      environment: facts?.environment ?? null,
      sources: this.fixture.hashes,
      snapshotFingerprint: facts ? this.fingerprint(facts) : null,
      checks: Object.freeze(checks.items),
      externalEvidence: Object.freeze({
        twoRenderedClients: 'not_assessed',
        pauseResume: 'not_assessed',
        ci: 'not_assessed',
        video: 'not_assessed',
      }),
    });
  }
  private unavailable(phase: ReplayReport['phase'], runId: string | null): ReplayReport {
    const checks = new Checks();
    checks.add(
      'coherent-read',
      'Lectura coherente no disponible',
      'lectura de evidencia',
      true,
      null,
      'unavailable',
    );
    return this.report(phase, null, runId, checks);
  }
}
