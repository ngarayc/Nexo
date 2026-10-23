import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import type { ReplayControl } from '@nexo/contracts';
import {
  AdmitReplayCommand,
  ReplayAdmissionNotApplied,
  ReplayAdmissionUnknown,
} from './admit-command.js';
import type { CommandAdmission } from './admit-command.js';
import { ReplayCommandReceipts } from './command-receipts.js';
import type { ReplayAdmission } from './command-receipts.js';
import type { ReplayJournal, ReplaySnapshot, ReplayRun, ReplayIntention } from './journal.js';
import { ReplayEmitter } from './replay-emitter.js';
import type { ReplayDispatch } from './replay-emitter.js';
import type { OfficialFixture } from './official-fixture.js';
import type { ReplayDelivery, SendReplayLine } from './send-replay-line.js';
import type { ReplayReport } from './verification.js';
import type { VerifyOfficialReplay } from './verify-official.js';
import { readReplayCommand, readReplayUuid } from '../domain/command.js';
import type { ReplayAction, ReplayCommand } from '../domain/command.js';
import { ReplayConflict, ReplayCapacity } from '../domain/replay.js';
import type { ReplayFailureCode } from '../domain/replay.js';

export interface ReplayCoordination {
  run<T>(operation: () => Promise<T>): Promise<T>;
}
export class ReplayPreconditionsFailed extends Error {
  constructor(readonly report: ReplayReport) {
    super('No se cumplen las condiciones para iniciar esta reproducción.');
  }
}
interface DeliveryWaiting {
  readonly dispatch: ReplayDispatch;
  readonly delivery: ReplayDelivery;
  readonly resolve: (interval: number | null) => void;
  readonly reject: (error: unknown) => void;
}
export type ReplayControlView = ReplayControl;

// La composición HTTP/SSE permanece fuera de esta clase. El ejecutor limita y
// serializa únicamente secciones de control/diario, nunca la petición de ingesta.
// La composición pública necesita demostrar además sus fronteras SQL/HTTP,
// acceso y publicación SSE; las pruebas de este actor no sustituyen esas pruebas.
export class ReplayCoordinator {
  readonly instanceId: string;
  readonly admissions: AdmitReplayCommand;
  private readonly emitter: ReplayEmitter;
  private current: ReplaySnapshot | undefined;
  private scenario: ReplayRun | undefined;
  private ready = false;
  private closed = false;
  private failed = false;
  private controlVersion = 0;
  private viewRevision = 0;
  private pendingAdmission: ReplayCommand | undefined;
  private pendingPause: string | undefined;
  private pendingPreparation: string | undefined;
  private pendingRestart: { command: ReplayCommand; intervalMs: number } | undefined;
  private pendingCreation: { runId: string; intention: ReplayIntention } | undefined;
  private pendingFinish: string | undefined;
  private pendingScenarioClose:
    { runId: string; result: ReplayReport['result']; document: string } | undefined;
  private waiting: DeliveryWaiting | undefined;

  constructor(
    private readonly journal: ReplayJournal,
    private readonly fixture: OfficialFixture,
    producer: SendReplayLine,
    private readonly verifier: Pick<
      VerifyOfficialReplay,
      'prepare' | 'evaluate' | 'prepareSecond' | 'prepareContinuation' | 'evaluateScenario'
    >,
    private readonly coordination: ReplayCoordination,
    instanceId = randomUUID(),
    private readonly changed: () => void = () => {},
  ) {
    this.instanceId = readReplayUuid(instanceId);
    this.admissions = new AdmitReplayCommand(journal, new ReplayCommandReceipts(), this.instanceId);
    this.emitter = new ReplayEmitter(
      {
        claim: () => this.coordination.run(() => this.claim()),
        settle: (dispatch, delivery) => this.settle(dispatch, delivery),
        blocked: () => this.block(),
      },
      producer,
    );
  }
  async initialize(): Promise<void> {
    await this.coordination.run(async () => {
      await this.journal.recover();
      this.install(await this.journal.current());
      await this.refreshScenario();
      this.ready = true;
      if (this.current?.run.state === 'completed' && this.current.run.verification === 'pending')
        this.background(() => this.verifyCompleted(this.current!.run.runId));
    });
  }
  close(): void {
    this.closed = true;
    this.emitter.close();
    this.waiting?.reject(new ReplayAdmissionUnknown());
    this.waiting = undefined;
  }
  async whenIdle(): Promise<void> {
    await this.emitter.whenIdle();
  }
  async view(): Promise<ReplayControlView> {
    return this.coordination.run(async () => {
      await this.confirmAdmission();
      await this.recoverJournal();
      this.install(await this.journal.current());
      await this.refreshScenario();
      return this.representation();
    });
  }
  async command(value: unknown): Promise<ReplayAdmission> {
    const command = readReplayCommand(value);
    return this.coordination.run(async () => {
      if (command.instanceId !== this.instanceId) throw new ReplayConflict();
      const receipt = this.admissions.receipts.find(command);
      if (receipt) return receipt.admission;
      if (this.pendingAdmission) {
        await this.confirmAdmission();
        const confirmed = this.admissions.receipts.find(command);
        if (confirmed) return confirmed.admission;
      }
      if (
        command.expectedControlVersion !== this.controlVersion ||
        command.runId !== (this.current?.run.runId ?? null) ||
        !this.actions().includes(command.action)
      )
        throw new ReplayConflict();
      if (this.controlVersion >= Number.MAX_SAFE_INTEGER - 1) throw new ReplayCapacity();
      if (command.action === 'start') {
        const prepared = await this.verifier.prepare();
        if (prepared.result !== 'conformant') throw new ReplayPreconditionsFailed(prepared);
        const runId = randomUUID();
        this.pendingAdmission = command;
        try {
          const result = await this.admissions.create(command, {
            runId,
            scenarioId: runId,
            previousRunId: null,
            instanceId: this.instanceId,
            fixtureSha256: this.fixture.fixtureSha256,
            stage: 'first',
            intervalMs: command.intervalMs ?? 750,
          });
          return this.accept(command, result);
        } catch (error) {
          this.admissionFailed();
          throw error;
        }
      }
      const snapshot = this.current!;
      if (
        command.action === 'restart' &&
        ['completed', 'stopped', 'error', 'interrupted'].includes(snapshot.run.state)
      ) {
        const second = this.secondEligible(snapshot);
        const prepared = second
          ? await this.verifier.prepareSecond(snapshot.run.runId)
          : await this.prepareContinuation(snapshot.run.runId);
        if (prepared.result !== 'conformant') throw new ReplayPreconditionsFailed(prepared);
        this.pendingAdmission = command;
        try {
          const result = await this.admissions.create(command, {
            runId: randomUUID(),
            scenarioId: snapshot.run.scenarioId,
            previousRunId: snapshot.run.runId,
            instanceId: this.instanceId,
            fixtureSha256: this.fixture.fixtureSha256,
            stage: second ? 'second' : 'exploratory',
            intervalMs: command.intervalMs ?? snapshot.run.intervalMs,
          });
          return this.accept(command, result);
        } catch (error) {
          this.admissionFailed();
          throw error;
        }
      }
      this.pendingAdmission = command;
      try {
        const result = await this.admissions.transition(command, snapshot.run.revision, {
          state:
            command.action === 'pause'
              ? 'pausing'
              : command.action === 'restart'
                ? 'restarting'
                : command.action === 'finishVerification'
                  ? ['completed', 'stopped', 'error', 'interrupted'].includes(snapshot.run.state)
                    ? snapshot.run.state
                    : 'finalizing'
                  : 'running',
          ...(command.action === 'resume' && command.intervalMs !== undefined
            ? { intervalMs: command.intervalMs }
            : {}),
        });
        return this.accept(command, result);
      } catch (error) {
        this.admissionFailed();
        throw error;
      }
    });
  }
  private admissionFailed(): void {
    if (this.admissions.blocked) this.emitter.inhibit();
    else this.pendingAdmission = undefined;
  }
  private async confirmAdmission(): Promise<void> {
    if (!this.pendingAdmission || !this.admissions.blocked) return;
    const command = this.pendingAdmission;
    try {
      const result = await this.admissions.confirm();
      this.accept(command, result);
    } catch (error) {
      if (error instanceof ReplayAdmissionNotApplied) {
        this.pendingAdmission = undefined;
        this.controlVersion++;
        this.viewRevision++;
        this.notify();
        this.flushWaiting();
        if (!this.waiting && this.current?.run.state === 'running')
          this.emitter.arm(this.current.run.intervalMs);
      } else throw error;
    }
  }
  private accept(command: ReplayCommand, result: CommandAdmission): ReplayAdmission {
    if (result.state === 'existing') return result.receipt.admission;
    this.pendingAdmission = undefined;
    this.controlVersion = result.receipt.admission.admittedControlVersion;
    this.install(result.snapshot, true);
    if (
      command.action === 'start' ||
      (command.action === 'restart' && result.snapshot.run.state === 'preparing')
    ) {
      this.pendingPreparation = command.commandId;
      this.background(() => this.prepareRun(command.commandId));
    } else if (command.action === 'pause') {
      this.emitter.inhibit();
      this.pendingPause = command.commandId;
      if (this.current!.progress.inFlight === 0) this.background(() => this.finishPause());
    } else if (command.action === 'resume') {
      this.admissions.receipts.resolve(command.commandId);
      this.emitter.arm(this.current!.run.intervalMs);
    } else if (command.action === 'restart') {
      this.emitter.inhibit();
      this.pendingRestart = {
        command,
        intervalMs: command.intervalMs ?? this.current!.run.intervalMs,
      };
      if (this.current!.progress.inFlight === 0) this.background(() => this.finishRestart());
    } else if (command.action === 'finishVerification') {
      this.emitter.inhibit();
      this.pendingFinish = command.commandId;
      if (this.current!.progress.inFlight === 0) this.background(() => this.finishVerification());
    }
    this.flushWaiting();
    return result.receipt.admission;
  }
  private async prepareRun(commandId: string): Promise<void> {
    const runId = this.current!.run.runId;
    const run = this.current!.run;
    const report =
      run.stage === 'first'
        ? await this.verifier.prepare(runId)
        : run.stage === 'second'
          ? await this.verifier.prepareSecond(run.previousRunId!, runId)
          : await this.prepareContinuation(run.previousRunId!);
    await this.coordination.run(async () => {
      const snapshot = this.current!;
      if (this.closed || snapshot.run.runId !== runId || snapshot.run.state !== 'preparing') return;
      if (report.result !== 'conformant') {
        const document = JSON.stringify({
          ...report,
          phase: snapshot.run.stage === 'second' ? 'second' : 'first',
          runId,
          scenarioId: snapshot.run.scenarioId,
          runRevision: snapshot.run.revision,
        });
        this.install(
          await this.journal.transition(runId, snapshot.run.revision, {
            state: 'error',
            closeCode: 'NOT_ADMITTED',
            finalVerification: { result: report.result, document },
          }),
        );
        this.admissions.receipts.resolve(commandId, 'PRECONDITIONS_FAILED');
        this.pendingPreparation = undefined;
        return;
      }
      this.install(
        await this.journal.transition(runId, snapshot.run.revision, { state: 'running' }),
      );
      this.admissions.receipts.resolve(commandId);
      this.pendingPreparation = undefined;
      this.emitter.arm(0);
    });
  }
  private async finishPause(): Promise<void> {
    await this.coordination.run(async () => {
      if (
        this.admissions.blocked ||
        this.closed ||
        this.current?.run.state !== 'pausing' ||
        this.current.progress.inFlight
      )
        return;
      this.install(
        await this.journal.transition(this.current.run.runId, this.current.run.revision, {
          state: 'paused',
        }),
      );
      this.resolvePause();
    });
  }
  private resolvePause(failure: ReplayFailureCode | null = null): void {
    if (this.pendingPause) this.admissions.receipts.resolve(this.pendingPause, failure);
    this.pendingPause = undefined;
  }
  private async claim(): Promise<ReplayDispatch | null> {
    if (
      !this.ready ||
      this.closed ||
      this.failed ||
      this.admissions.blocked ||
      this.current?.run.state !== 'running'
    )
      return null;
    const row = this.fixture.rows[this.current.run.nextLine - 1];
    if (!row) throw new ReplayConflict();
    const ingestionId = randomUUID();
    this.install(
      await this.journal.beginAttempt(
        this.current.run.runId,
        this.current.run.revision,
        ingestionId,
        row.eventId,
      ),
    );
    return { line: row, ingestionId };
  }
  private async settle(dispatch: ReplayDispatch, delivery: ReplayDelivery): Promise<number | null> {
    const result = await this.coordination.run(async () => {
      if (this.admissions.blocked) {
        const pending = new Promise<number | null>((resolve, reject) => {
          this.waiting = { dispatch, delivery, resolve, reject };
        });
        return { pending };
      }
      return { interval: await this.persistDelivery(dispatch, delivery) };
    });
    return 'pending' in result ? result.pending : result.interval;
  }
  private flushWaiting(): void {
    const waiting = this.waiting;
    if (!waiting || this.admissions.blocked) return;
    this.waiting = undefined;
    void this.coordination
      .run(() => this.persistDelivery(waiting.dispatch, waiting.delivery))
      .then((interval) => {
        waiting.resolve(interval);
        if (interval !== null) this.emitter.arm(interval);
      }, waiting.reject);
  }
  private async persistDelivery(
    dispatch: ReplayDispatch,
    delivery: ReplayDelivery,
  ): Promise<number | null> {
    const snapshot = this.current!;
    if (snapshot.attempts.at(-1)?.ingestionId !== dispatch.ingestionId) throw new ReplayConflict();
    const result =
      delivery.state === 'classified'
        ? delivery
        : {
            state: delivery.state,
            httpStatus: delivery.httpStatus,
            diagnosticDocument: delivery.diagnosticDocument,
          };
    this.install(
      await this.journal.resolveAttempt(
        snapshot.run.runId,
        snapshot.run.revision,
        result,
        delivery.state === 'classified'
          ? {
              state:
                snapshot.run.state === 'pausing'
                  ? 'paused'
                  : snapshot.run.state === 'restarting'
                    ? 'restarting'
                    : snapshot.run.state === 'finalizing'
                      ? 'finalizing'
                      : 'running',
            }
          : {
              state: 'error',
              closeCode: delivery.closeCode,
              finalVerification: {
                result: 'inconclusive',
                document: JSON.stringify(this.inconclusive(snapshot, delivery.closeCode)),
              },
            },
      ),
    );
    if (delivery.state !== 'classified') {
      this.resolvePause(delivery.closeCode);
      this.resolveRestart(delivery.closeCode);
      if (this.pendingFinish) this.background(() => this.finishVerification());
      return null;
    }
    if (this.current!.run.state === 'completed') {
      this.resolvePause();
      this.background(async () => {
        await this.verifyCompleted(snapshot.run.runId);
        if (this.pendingRestart) await this.finishRestart();
        else if (this.pendingFinish) await this.finishVerification();
      });
      return null;
    }
    if (this.current!.run.state === 'paused') {
      this.resolvePause();
      return null;
    }
    if (this.current!.run.state === 'restarting') {
      this.background(() => this.finishRestart());
      return null;
    }
    if (this.current!.run.state === 'finalizing') {
      this.background(() => this.finishVerification());
      return null;
    }
    return this.current!.run.intervalMs;
  }
  private async verifyCompleted(runId: string): Promise<void> {
    const deadline = Date.now() + 10000;
    let report: ReplayReport;
    do {
      report = await this.verifier.evaluate(runId);
      if (
        report.result !== 'inconclusive' ||
        !report.checks.some((check) => check.state === 'pending')
      )
        break;
      if (Date.now() >= deadline || this.closed) break;
      await wait(100);
    } while (Date.now() < deadline && !this.closed);
    await this.coordination.run(async () => {
      if (
        this.closed ||
        this.failed ||
        this.admissions.blocked ||
        this.current?.run.runId !== runId ||
        this.current.run.verification !== 'pending'
      )
        return;
      this.install(
        await this.journal.verify(
          runId,
          this.current.run.revision,
          report.result,
          JSON.stringify(report),
        ),
      );
    });
  }
  private inconclusive(snapshot: ReplaySnapshot, code: ReplayFailureCode): ReplayReport {
    return {
      version: 1,
      scope: 'data-and-replays',
      phase: snapshot.run.stage === 'second' ? 'second' : 'first',
      result: 'inconclusive',
      observedAt: null,
      attemptedAt: new Date().toISOString(),
      runId: snapshot.run.runId,
      scenarioId: snapshot.run.scenarioId,
      runRevision: snapshot.run.revision,
      environment: null,
      sources: this.fixture.hashes,
      snapshotFingerprint: null,
      checks: [
        {
          key: 'delivery-unconfirmed',
          label: 'Envío sin clasificación confirmada',
          source: 'respuesta original del emisor',
          expected: 'Resultado final confirmado',
          observed: code,
          state: 'unavailable',
        },
      ],
      externalEvidence: {
        twoRenderedClients: 'not_assessed',
        pauseResume: 'not_assessed',
        ci: 'not_assessed',
      },
    };
  }
  private install(snapshot: ReplaySnapshot | undefined, admission = false): void {
    const old = this.current;
    if (old?.run.runId === snapshot?.run.runId && old?.run.revision === snapshot?.run.revision)
      return;
    if (
      !admission &&
      (old?.run.runId !== snapshot?.run.runId ||
        old?.run.state !== snapshot?.run.state ||
        old?.run.verification !== snapshot?.run.verification)
    )
      this.controlVersion++;
    this.current = snapshot;
    if (snapshot?.run.stage === 'first') this.scenario = snapshot.run;
    this.viewRevision++;
    this.notify();
  }
  private actions(): readonly ReplayAction[] {
    if (
      !this.ready ||
      this.closed ||
      this.failed ||
      this.admissions.blocked ||
      this.pendingRestart ||
      this.pendingPreparation ||
      this.pendingFinish
    )
      return [];
    if (!this.current) return ['start'];
    if (['completed', 'stopped', 'error', 'interrupted'].includes(this.current.run.state))
      return this.current.run.verification === 'pending'
        ? []
        : this.scenario?.scenarioClosedAt
          ? ['restart']
          : ['restart', 'finishVerification'];
    if (this.current.run.instanceId !== this.instanceId) return [];
    if (this.scenario?.scenarioClosedAt && this.current.run.stage !== 'exploratory') return [];
    if (this.current.run.state === 'running') return ['pause', 'restart', 'finishVerification'];
    if (this.current.run.state === 'paused') return ['resume', 'restart', 'finishVerification'];
    return [];
  }
  private representation(): ReplayControlView {
    const run = this.current?.run;
    return {
      instanceId: this.instanceId,
      controlVersion: this.controlVersion,
      viewRevision: this.viewRevision,
      observedAt: new Date().toISOString(),
      blockedReason: this.closed
        ? 'SHUTTING_DOWN'
        : !this.ready
          ? 'RECOVERING'
          : this.failed || this.admissions.blocked
            ? 'JOURNAL_UNCERTAIN'
            : null,
      allowedActions: this.actions(),
      pendingAction: this.pendingFinish
        ? 'finishVerification'
        : this.pendingRestart
          ? 'restart'
          : this.pendingPause
            ? 'pause'
            : this.pendingPreparation
              ? this.current?.run.previousRunId
                ? 'restart'
                : 'start'
              : (this.pendingAdmission?.action ?? null),
      scenario: this.scenario
        ? {
            scenarioId: this.scenario.runId,
            verification: this.scenario.scenarioVerification,
            closedAt: this.scenario.scenarioClosedAt,
          }
        : null,
      run: run
        ? {
            runId: run.runId,
            scenarioId: run.scenarioId,
            stage: run.stage,
            state: run.state,
            verification: run.verification,
            intervalMs: run.intervalMs,
            nextLine: run.nextLine,
            closeCode: run.closeCode,
            progress: this.current!.progress,
          }
        : null,
    };
  }
  private block(): void {
    if (!this.failed) {
      this.controlVersion++;
      this.viewRevision++;
    }
    this.failed = true;
    this.emitter.inhibit();
    if (this.pendingPreparation) {
      if (this.admissions.receipts.get(this.pendingPreparation)?.resolution === 'pending')
        this.admissions.receipts.resolve(this.pendingPreparation, 'JOURNAL_UNCERTAIN');
      this.pendingPreparation = undefined;
    }
    this.resolvePause('JOURNAL_UNCERTAIN');
    this.resolveRestart('JOURNAL_UNCERTAIN');
    this.notify();
  }
  private async recoverJournal(): Promise<void> {
    if (!this.failed || this.closed || this.admissions.blocked) return;
    const previous = this.current;
    const target = this.pendingCreation;
    const marker = target?.intention ?? previous?.run.intention;
    if (!previous || !marker) throw new ReplayAdmissionUnknown();
    try {
      const confirmation = await this.journal.confirmIntention(
        target?.runId ?? previous.run.runId,
        target ? null : previous.run.revision,
        marker,
      );
      let snapshot = confirmation.snapshot;
      if (target && confirmation.state === 'not_applied') {
        this.pendingCreation = undefined;
        this.failed = false;
        this.controlVersion++;
        this.viewRevision++;
        this.notify();
        return;
      }
      if (
        confirmation.state !== 'applied' ||
        !snapshot ||
        (!target && snapshot.run.revision < previous.run.revision)
      )
        throw new ReplayAdmissionUnknown();
      if (this.pendingScenarioClose) {
        const target = this.pendingScenarioClose;
        const root = await this.journal.find(target.runId);
        if (!root) throw new ReplayAdmissionUnknown();
        if (
          root.run.scenarioVerification === target.result &&
          root.run.scenarioDocument === target.document
        ) {
          this.scenario = root.run;
          if (this.current?.run.runId === root.run.runId) this.install(root);
          this.resolveFinish();
        } else if (root.run.scenarioVerification === 'pending') {
          this.resolveFinish('JOURNAL_UNCERTAIN');
        } else throw new ReplayAdmissionUnknown();
        this.pendingScenarioClose = undefined;
        this.failed = false;
        this.controlVersion++;
        this.viewRevision++;
        this.notify();
        return;
      }
      const document = JSON.stringify(this.inconclusive(snapshot, 'JOURNAL_UNCERTAIN'));
      if (['completed', 'stopped', 'error', 'interrupted'].includes(snapshot.run.state)) {
        if (snapshot.run.verification === 'pending')
          snapshot = await this.journal.verify(
            snapshot.run.runId,
            snapshot.run.revision,
            'inconclusive',
            document,
          );
      } else {
        const change = {
          state: 'error' as const,
          closeCode: 'JOURNAL_UNCERTAIN' as const,
          finalVerification: { result: 'inconclusive' as const, document },
        };
        if (snapshot.attempts.at(-1)?.state === 'in_flight')
          snapshot = await this.journal.resolveAttempt(
            snapshot.run.runId,
            snapshot.run.revision,
            {
              state: 'uncertain',
              httpStatus: null,
              diagnosticDocument: JSON.stringify({ code: 'JOURNAL_UNCERTAIN', truncated: false }),
            },
            change,
          );
        else
          snapshot = await this.journal.transition(
            snapshot.run.runId,
            snapshot.run.revision,
            change,
          );
      }
      this.install(snapshot);
      this.pendingCreation = undefined;
      this.failed = false;
      this.controlVersion++;
      this.viewRevision++;
      this.notify();
      if (this.pendingFinish) this.background(() => this.finishVerification());
    } catch {
      // Ni una lectura fallida ni otra respuesta COMMIT perdida autorizan un
      // envío. Una consulta posterior puede observar el mismo cierre durable.
      throw new ReplayAdmissionUnknown();
    }
  }
  private notify(): void {
    try {
      this.changed();
    } catch {
      // Un observador de estado no controla el motor ni invalida su COMMIT.
    }
  }
  private background(operation: () => Promise<void>): void {
    void Promise.resolve()
      .then(operation)
      .catch(() => this.block());
  }
  private prepareContinuation(runId: string): Promise<ReplayReport> {
    return this.scenario?.scenarioClosedAt
      ? this.verifier.prepareContinuation(runId, true)
      : this.verifier.prepareContinuation(runId);
  }
  private secondEligible(snapshot: ReplaySnapshot): boolean {
    return (
      !this.scenario?.scenarioClosedAt &&
      snapshot.run.stage === 'first' &&
      snapshot.run.state === 'completed' &&
      snapshot.run.verification === 'conformant'
    );
  }
  private resolveRestart(failure: ReplayFailureCode | 'PRECONDITIONS_FAILED'): void {
    if (!this.pendingRestart) return;
    const id = this.pendingRestart.command.commandId;
    if (this.admissions.receipts.get(id)?.resolution === 'pending')
      this.admissions.receipts.resolve(id, failure);
    this.pendingRestart = undefined;
  }
  private async refreshScenario(): Promise<void> {
    if (!this.current) {
      this.scenario = undefined;
      return;
    }
    const root =
      this.current.run.runId === this.current.run.scenarioId
        ? this.current
        : await this.journal.find(this.current.run.scenarioId);
    if (!root || root.run.runId !== this.current.run.scenarioId || root.run.stage !== 'first')
      throw new ReplayAdmissionUnknown();
    if (
      this.scenario?.scenarioClosedAt !== root.run.scenarioClosedAt ||
      this.scenario?.scenarioVerification !== root.run.scenarioVerification
    ) {
      this.controlVersion++;
      this.viewRevision++;
    }
    this.scenario = root.run;
  }
  private async finishRestart(): Promise<void> {
    const request = this.pendingRestart;
    if (!request) return;
    const prior = await this.coordination.run(async () => {
      if (this.closed || this.failed || this.admissions.blocked || this.pendingRestart !== request)
        return null;
      const snapshot = this.current!;
      if (snapshot.progress.inFlight) return null;
      if (snapshot.run.state === 'restarting') {
        this.install(
          await this.journal.transition(snapshot.run.runId, snapshot.run.revision, {
            state: 'stopped',
            closeCode: 'USER_RESTARTED',
            finalVerification: {
              result: 'inconclusive',
              document: JSON.stringify(this.inconclusive(snapshot, 'USER_RESTARTED')),
            },
          }),
        );
      }
      return this.current!;
    });
    if (!prior) return;
    const second = this.secondEligible(prior),
      deadline = Date.now() + 10000;
    let report: ReplayReport;
    do {
      report = second
        ? await this.verifier.prepareSecond(prior.run.runId)
        : await this.prepareContinuation(prior.run.runId);
      if (
        report.result !== 'inconclusive' ||
        !report.checks.some((check) => check.state === 'pending') ||
        this.closed ||
        Date.now() >= deadline
      )
        break;
      await wait(100);
    } while (Date.now() < deadline && !this.closed);
    await this.coordination.run(async () => {
      if (this.closed || this.failed || this.admissions.blocked || this.pendingRestart !== request)
        return;
      if (report.result !== 'conformant') {
        this.resolveRestart('PRECONDITIONS_FAILED');
        this.controlVersion++;
        this.viewRevision++;
        this.notify();
        return;
      }
      const marker = prior.run.intention;
      if (!marker || marker.commandId !== request.command.commandId) throw new ReplayConflict();
      const runId = randomUUID();
      this.pendingCreation = { runId, intention: marker };
      const snapshot = await this.journal.create({
        runId,
        scenarioId: prior.run.scenarioId,
        previousRunId: prior.run.runId,
        instanceId: this.instanceId,
        fixtureSha256: this.fixture.fixtureSha256,
        stage: second ? 'second' : 'exploratory',
        intervalMs: request.intervalMs,
        intention: marker,
      });
      this.pendingCreation = undefined;
      this.install(snapshot);
      this.pendingRestart = undefined;
      this.pendingPreparation = request.command.commandId;
      this.background(() => this.prepareRun(request.command.commandId));
    });
  }
  private resolveFinish(failure: ReplayFailureCode | null = null): void {
    if (!this.pendingFinish) return;
    if (this.admissions.receipts.get(this.pendingFinish)?.resolution === 'pending')
      this.admissions.receipts.resolve(this.pendingFinish, failure);
    this.pendingFinish = undefined;
  }
  private async finishVerification(): Promise<void> {
    const commandId = this.pendingFinish;
    if (!commandId) return;
    const snapshot = await this.coordination.run(async () => {
      if (
        this.closed ||
        this.failed ||
        this.admissions.blocked ||
        this.pendingFinish !== commandId ||
        this.current!.progress.inFlight
      )
        return null;
      const current = this.current!;
      if (current.run.state === 'finalizing') {
        this.install(
          await this.journal.transition(current.run.runId, current.run.revision, {
            state: 'stopped',
            closeCode: 'VERIFICATION_CLOSED',
            finalVerification: {
              result: 'inconclusive',
              document: JSON.stringify(this.inconclusive(current, 'VERIFICATION_CLOSED')),
            },
          }),
        );
      }
      return this.current!;
    });
    if (!snapshot) return;
    if (this.scenario?.scenarioClosedAt) {
      // Detener un sufijo exploratorio no reescribe ni vuelve a evaluar el par.
      if (snapshot.run.stage !== 'exploratory') throw new ReplayConflict();
      await this.coordination.run(async () => {
        if (this.closed || this.failed || this.pendingFinish !== commandId) return;
        this.resolveFinish();
        this.controlVersion++;
        this.viewRevision++;
        this.notify();
      });
      return;
    }
    const report =
      snapshot.run.state === 'completed'
        ? await this.verifier.evaluateScenario(snapshot.run.runId)
        : this.inconclusive(snapshot, 'VERIFICATION_CLOSED');
    await this.coordination.run(async () => {
      if (this.closed || this.failed || this.admissions.blocked || this.pendingFinish !== commandId)
        return;
      const root = await this.journal.find(snapshot.run.scenarioId);
      if (!root) throw new ReplayAdmissionUnknown();
      const document = JSON.stringify(report);
      this.pendingScenarioClose = { runId: root.run.runId, result: report.result, document };
      const closed = await this.journal.closeScenario(
        root.run.runId,
        root.run.revision,
        report.result,
        document,
      );
      this.pendingScenarioClose = undefined;
      this.scenario = closed.run;
      if (this.current!.run.runId === closed.run.runId) this.install(closed);
      this.resolveFinish();
      this.controlVersion++;
      this.viewRevision++;
      this.notify();
    });
  }
}
