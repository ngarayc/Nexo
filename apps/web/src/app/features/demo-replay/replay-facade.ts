import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  ReplayControl,
  ReplayAction,
  ReplayCommandDto,
  ReplayDetailDto,
  ReplayRunDto,
  ReplayReportDto,
} from '@nexo/contracts';
import { ReplayApi } from '../../platform/replay/replay-api';
import { readReplayReport } from '../../platform/replay/replay-contract';
import { LIVE_CLOCK } from '../../platform/telemetry/stream-transport';
import { LiveMonitor } from '../live-monitoring/live-monitor';

@Injectable({ providedIn: 'root' })
export class ReplayFacade implements OnDestroy {
  private readonly api = inject(ReplayApi);
  private readonly monitor = inject(LiveMonitor);
  private readonly clock = inject(LIVE_CLOCK);
  private readonly viewValue = signal<ReplayControl | null>(null);
  private readonly staleValue = signal(true);
  private readonly pendingValue = signal<ReplayCommandDto | null>(null);
  private readonly errorValue = signal<string | null>(null);
  private readonly noticeValue = signal<string | null>(null);
  private readonly detailValue = signal<ReplayDetailDto | null>(null);
  private readonly historyValue = signal<readonly ReplayRunDto[]>([]);
  private readonly selectedValue = signal<string | null>(null);
  private readonly preparationValue = signal<ReplayReportDto | null>(null);
  readonly view = this.viewValue.asReadonly();
  readonly stale = this.staleValue.asReadonly();
  readonly pending = this.pendingValue.asReadonly();
  readonly error = this.errorValue.asReadonly();
  readonly notice = this.noticeValue.asReadonly();
  readonly detail = this.detailValue.asReadonly();
  readonly history = this.historyValue.asReadonly();
  readonly selectedRunId = this.selectedValue.asReadonly();
  readonly preparation = this.preparationValue.asReadonly();
  readonly historyCursor = signal<string | null>(null);
  private generation: number | undefined;
  private request: AbortController | undefined;
  private detailRequest: AbortController | undefined;
  private commandRequest: AbortController | undefined;
  private receiptRequest: AbortController | undefined;
  private historyRequest: AbortController | undefined;
  private staleTimer: (() => void) | undefined;
  private receiptTimer: (() => void) | undefined;
  private verified = { monotonic: -Infinity, wall: -Infinity };
  private receiptDeadline = 0;
  private destroyed = false;
  private readonly removeReplay = this.monitor.onReplay((view, generation) =>
    this.install(view, generation),
  );
  private readonly removeInvalidated = this.monitor.onInvalidated((clear) =>
    this.invalidate(clear),
  );
  private readonly removeReady = this.monitor.onReady((generation) => {
    this.generation = generation;
    void this.refresh();
  });

  can(action: ReplayAction): boolean {
    return (
      this.fresh() &&
      this.monitor.retryWait <= 0 &&
      !this.pending() &&
      (this.view()?.allowedActions.includes(action) ?? false)
    );
  }
  private fresh(): boolean {
    return (
      !this.destroyed &&
      !this.stale() &&
      this.generation !== undefined &&
      this.generation === this.monitor.currentGeneration &&
      Math.max(this.clock.now() - this.verified.monotonic, this.clock.wall() - this.verified.wall) <
        10000
    );
  }
  async refresh(): Promise<void> {
    if (this.monitor.retryWait > 0) {
      this.errorValue.set(
        'Espera el plazo indicado por el servidor antes de recuperar el control.',
      );
      return;
    }
    const generation = this.monitor.currentGeneration;
    if (generation === undefined) {
      this.monitor.reconnect();
      return;
    }
    this.generation = generation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    try {
      const view = await this.api.current(request.signal);
      if (request.signal.aborted || this.generation !== generation || this.request !== request)
        return;
      this.install(view, generation);
      this.checkReceipt();
    } catch (error) {
      if (!request.signal.aborted && this.generation === generation) {
        this.staleValue.set(true);
        this.errorValue.set(this.explain(error));
      }
    } finally {
      if (this.request === request) this.request = undefined;
    }
  }
  private install(view: ReplayControl, generation: number): void {
    if (
      this.destroyed ||
      generation !== this.generation ||
      generation !== this.monitor.currentGeneration
    )
      return;
    const old = this.view();
    if (
      old?.instanceId === view.instanceId &&
      (view.viewRevision < old.viewRevision ||
        view.controlVersion < old.controlVersion ||
        (view.viewRevision === old.viewRevision &&
          Date.parse(view.observedAt) < Date.parse(old.observedAt)))
    )
      return;
    const changed = old?.instanceId !== view.instanceId || old.viewRevision !== view.viewRevision;
    if (old && old.instanceId !== view.instanceId) {
      this.detailRequest?.abort();
      this.historyRequest?.abort();
      this.selectedValue.set(null);
      this.detailValue.set(null);
      this.historyValue.set([]);
      this.historyCursor.set(null);
    }
    const pending = this.pending();
    if (pending && pending.instanceId !== view.instanceId) {
      this.pendingValue.set(null);
      this.receiptTimer?.();
      this.receiptRequest?.abort();
      this.noticeValue.set(
        'La API se reinició. La orden anterior no se repetirá; consulta el recorrido recuperado.',
      );
    }
    this.viewValue.set(view);
    this.staleValue.set(false);
    this.errorValue.set(null);
    this.verified = { monotonic: this.clock.now(), wall: this.clock.wall() };
    this.staleTimer?.();
    this.staleTimer = this.clock.after(10000, () => {
      this.staleValue.set(true);
    });
    if (changed && !this.selectedRunId() && view.run) void this.loadDetail(view.run.runId);
    if (this.pending()) this.checkReceipt();
  }
  async execute(action: ReplayAction, intervalMs?: number): Promise<void> {
    if (!this.can(action)) {
      this.errorValue.set('Recupera el control vigente antes de enviar otra orden.');
      return;
    }
    if (
      ['start', 'restart', 'resume'].includes(action) &&
      (typeof intervalMs !== 'number' ||
        !Number.isInteger(intervalMs) ||
        intervalMs < 100 ||
        intervalMs > 5000)
    ) {
      this.errorValue.set('El intervalo debe ser un entero entre 100 y 5.000 milisegundos.');
      return;
    }
    const view = this.view()!,
      generation = this.generation;
    const command: ReplayCommandDto = {
      commandId: crypto.randomUUID(),
      instanceId: view.instanceId,
      expectedControlVersion: view.controlVersion,
      runId: view.run?.runId ?? null,
      action,
      ...(['start', 'restart', 'resume'].includes(action) && intervalMs !== undefined
        ? { intervalMs }
        : {}),
    };
    this.pendingValue.set(command);
    this.preparationValue.set(null);
    this.errorValue.set(null);
    this.noticeValue.set('Enviando la intención de control…');
    this.receiptDeadline = this.clock.now() + 15000;
    const request = new AbortController();
    this.commandRequest = request;
    try {
      await this.api.command(command, request.signal);
      if (
        request.signal.aborted ||
        this.generation !== generation ||
        this.pending()?.commandId !== command.commandId
      )
        return;
      this.noticeValue.set('Orden admitida. Esperando confirmación de su resultado…');
      this.checkReceipt();
      await this.refresh();
    } catch (error) {
      if (
        request.signal.aborted ||
        this.generation !== generation ||
        this.pending()?.commandId !== command.commandId
      )
        return;
      const known =
        (error instanceof HttpErrorResponse &&
          [400, 403, 409, 413, 415, 429].includes(error.status)) ||
        (error instanceof HttpErrorResponse && error.error?.admission === 'not_admitted');
      if (known) {
        const message = this.explain(error);
        this.pendingValue.set(null);
        this.errorValue.set(message);
        this.noticeValue.set(null);
        if (error instanceof HttpErrorResponse && error.error?.report) {
          try {
            this.preparationValue.set(readReplayReport(error.error.report));
          } catch {
            /* No mostrar un informe no comprobable. */
          }
        }
        await this.refresh();
        this.errorValue.set(message);
      } else {
        this.noticeValue.set(
          'Resultado de admisión todavía desconocido. Consultaremos la misma orden sin reenviarla.',
        );
        this.checkReceipt();
      }
    } finally {
      if (this.commandRequest === request) this.commandRequest = undefined;
    }
  }
  checkReceipt(): void {
    const command = this.pending(),
      generation = this.generation;
    if (
      !command ||
      generation === undefined ||
      generation !== this.monitor.currentGeneration ||
      this.receiptRequest ||
      this.destroyed
    )
      return;
    this.receiptTimer?.();
    this.receiptTimer = undefined;
    if (this.monitor.retryWait > 0) {
      const wait = this.monitor.retryWait;
      if (Number.isFinite(wait) && this.clock.now() + wait < this.receiptDeadline)
        this.receiptTimer = this.clock.after(wait, () => this.checkReceipt());
      return;
    }
    const request = new AbortController();
    this.receiptRequest = request;
    void this.api
      .receipt(command.commandId, command.instanceId, request.signal)
      .then((receipt) => {
        if (
          request.signal.aborted ||
          this.generation !== generation ||
          this.pending()?.commandId !== command.commandId
        )
          return;
        if (receipt.resolution === 'pending')
          this.noticeValue.set(
            'Orden admitida y pendiente. El servidor continúa su procesamiento.',
          );
        else {
          this.pendingValue.set(null);
          this.noticeValue.set(
            receipt.resolution === 'completed'
              ? 'Orden completada.'
              : 'La orden terminó con un fallo. Recupera el control y consulta el diagnóstico.',
          );
          if (receipt.reasonCode) this.errorValue.set('Motivo: ' + this.reason(receipt.reasonCode));
          void this.refresh();
        }
      })
      .catch((error) => {
        if (request.signal.aborted || this.generation !== generation) return;
        this.monitor.noteRetryAfter(error);
        this.noticeValue.set(
          'No se conoce aún el resultado de esta orden. Un recibo ausente no demuestra que no se admitiera. No se reenviará.',
        );
      })
      .finally(() => {
        if (this.receiptRequest !== request) return;
        this.receiptRequest = undefined;
        const wait = Math.max(500, this.monitor.retryWait);
        if (
          this.pending()?.commandId === command.commandId &&
          this.generation === generation &&
          this.clock.now() < this.receiptDeadline &&
          !this.destroyed &&
          Number.isFinite(wait)
        )
          this.receiptTimer = this.clock.after(wait, () => this.checkReceipt());
      });
  }
  selectRun(runId: string | null): void {
    this.selectedValue.set(runId);
    this.detailValue.set(null);
    const selected = runId ?? this.view()?.run?.runId;
    if (selected) void this.loadDetail(selected);
  }
  private async loadDetail(runId: string): Promise<void> {
    const generation = this.generation;
    this.detailRequest?.abort();
    const request = new AbortController();
    this.detailRequest = request;
    try {
      const detail = await this.api.detail(runId, request.signal);
      if (
        !request.signal.aborted &&
        this.generation === generation &&
        this.detailRequest === request &&
        (this.selectedRunId() ?? this.view()?.run?.runId) === runId
      )
        this.detailValue.set(detail);
    } catch (error) {
      if (!request.signal.aborted && this.generation === generation)
        this.errorValue.set(this.explain(error));
    } finally {
      if (this.detailRequest === request) this.detailRequest = undefined;
    }
  }
  async loadHistory(more = false): Promise<void> {
    if (this.historyRequest || this.generation === undefined) return;
    const generation = this.generation,
      request = new AbortController();
    this.historyRequest = request;
    try {
      const page = await this.api.history(
        request.signal,
        more ? (this.historyCursor() ?? undefined) : undefined,
      );
      if (request.signal.aborted || this.generation !== generation) return;
      const entries = more ? [...this.history(), ...page.items] : page.items;
      this.historyValue.set(
        [...new Map(entries.map((run) => [run.runId, run])).values()].slice(0, 1000),
      );
      this.historyCursor.set(page.nextCursor);
    } catch (error) {
      if (!request.signal.aborted && this.generation === generation)
        this.errorValue.set(this.explain(error));
    } finally {
      if (this.historyRequest === request) this.historyRequest = undefined;
    }
  }
  reason(code: string | null): string {
    const reasons: Record<string, string> = {
      INVALID_LATITUDE: 'Latitud fuera del rango permitido.',
      INVALID_SPEED: 'La velocidad debe ser un número válido.',
      TRANSPORT_UNCERTAIN: 'Se perdió la respuesta del envío; su resultado es incierto.',
      JOURNAL_UNCERTAIN: 'No se pudo confirmar una escritura del diario.',
      API_RESTARTED: 'La API se reinició y no reanudó envíos.',
      USER_RESTARTED: 'Se inició otro recorrido sin borrar los datos.',
      VERIFICATION_CLOSED: 'Se cerró la verificación antes de completar el par.',
      PRECONDITIONS_FAILED: 'No se cumplen las condiciones para el recorrido oficial.',
      RESPONSE_PENDING: 'El receptor continúa procesando el envío.',
      RESPONSE_INVALID: 'La respuesta no se pudo comprobar.',
      NOT_ADMITTED: 'El receptor no admitió el envío.',
      PROCESSING_FAILED: 'El receptor informó un fallo técnico.',
    };
    return code
      ? (reasons[code] ?? 'El servidor informó un diagnóstico. Consulta su código.')
      : 'Sin errores informados.';
  }
  private explain(error: unknown): string {
    this.monitor.noteRetryAfter(error);
    if (error instanceof HttpErrorResponse) {
      if (error.status === 409)
        return 'El estado cambió o no cumple las condiciones. Recupera el control actual.';
      if (error.status === 429)
        return 'Se alcanzó la cuota de solicitudes. Espera antes de consultar de nuevo.';
      if (error.status === 403)
        return 'Tu sesión no permite esta operación. Vuelve a iniciar sesión si venció.';
      if (error.status === 404) return 'La ejecución o el control solicitado no está disponible.';
    }
    return 'No se pudo comprobar el estado. Conservamos lo confirmado; recupera el control antes de continuar.';
  }
  private invalidate(clear: boolean): void {
    this.generation = undefined;
    this.staleValue.set(true);
    this.staleTimer?.();
    this.receiptTimer?.();
    for (const request of [
      this.request,
      this.detailRequest,
      this.commandRequest,
      this.receiptRequest,
      this.historyRequest,
    ])
      request?.abort();
    this.request =
      this.detailRequest =
      this.commandRequest =
      this.receiptRequest =
      this.historyRequest =
        undefined;
    if (clear) {
      this.viewValue.set(null);
      this.pendingValue.set(null);
      this.detailValue.set(null);
      this.historyValue.set([]);
      this.selectedValue.set(null);
      this.preparationValue.set(null);
      this.noticeValue.set(null);
      this.errorValue.set(null);
      this.historyCursor.set(null);
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.removeReplay();
    this.removeReady();
    this.removeInvalidated();
    this.invalidate(true);
  }
}
