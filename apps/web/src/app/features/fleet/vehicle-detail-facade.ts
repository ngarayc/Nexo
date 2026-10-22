import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import type { DomainChange, EventView } from '@nexo/contracts';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { TelemetryApi } from '../../platform/telemetry/telemetry-api';
import { LIVE_CLOCK } from '../../platform/telemetry/stream-transport';
import type { CaptureHandle } from '../../platform/telemetry/capture-budget';
import { compareViews } from '../../platform/telemetry/order';

export type DetailPhase = 'closed' | 'waiting' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class VehicleDetailFacade implements OnDestroy {
  private readonly monitor = inject(LiveMonitor);
  private readonly api = inject(TelemetryApi);
  private readonly clock = inject(LIVE_CLOCK);
  private readonly selectedValue = signal<string | null>(null);
  private readonly phaseValue = signal<DetailPhase>('closed');
  private readonly baseValue = signal(false);
  private readonly revision = signal(0);
  private readonly observations = new Map<string, EventView>();
  readonly selected = this.selectedValue.asReadonly();
  readonly phase = this.phaseValue.asReadonly();
  readonly hasBase = this.baseValue.asReadonly();
  readonly items = computed(() => {
    this.revision();
    return Object.freeze([...this.observations.values()].sort(compareViews));
  });
  readonly total = computed(() => this.items().length);
  private selection = 0;
  private request: AbortController | undefined;
  private capture: CaptureHandle | undefined;
  private delay: (() => void) | undefined;
  private readonly unsubscribe: (() => void)[];

  constructor() {
    this.unsubscribe = [
      this.monitor.onInvalidated((clear) => {
        this.cancel();
        if (clear) this.close();
        else if (this.selected() !== null) this.phaseValue.set('waiting');
      }),
      this.monitor.onFrame((change) => {
        if (this.phase() === 'ready' && this.add(change)) this.changed();
      }),
      this.monitor.onReady(() => {
        if (this.selected() !== null) this.load();
      }),
    ];
  }

  select(vehicleId: string): void {
    if (vehicleId === this.selected()) return;
    this.cancel();
    this.selectedValue.set(vehicleId);
    this.observations.clear();
    this.changed();
    this.baseValue.set(false);
    this.load();
  }
  retry(): void {
    if (this.selected() === null) return;
    this.cancel();
    this.load();
  }
  close(): void {
    this.cancel();
    this.selectedValue.set(null);
    this.observations.clear();
    this.changed();
    this.baseValue.set(false);
    this.phaseValue.set('closed');
  }

  private load(): void {
    this.cancel();
    const vehicleId = this.selected();
    const generation = this.monitor.currentGeneration;
    if (vehicleId === null) return;
    if (generation === undefined) {
      this.phaseValue.set('waiting');
      return;
    }
    const wait = this.monitor.retryWait;
    if (wait > 0) {
      this.phaseValue.set('waiting');
      if (Number.isFinite(wait)) this.delay = this.clock.after(wait, () => this.load());
      else this.phaseValue.set('error');
      return;
    }
    const selection = this.selection;
    const request = new AbortController();
    this.request = request;
    const capture = this.monitor.capture(
      (change) => change.type === 'telemetry.accepted' && change.vehicleId === vehicleId,
    );
    this.capture = capture;
    this.phaseValue.set('loading');
    // La captura ya existe antes de suscribir la solicitud HTTP.
    void this.api
      .history(vehicleId, request.signal)
      .then((history) => {
        if (!this.current(selection, generation, vehicleId) || request.signal.aborted) return;
        const changes = capture.take();
        this.capture = undefined;
        this.request = undefined;
        this.observations.clear();
        for (const observation of history.items)
          this.observations.set(observation.eventId, observation);
        for (const change of changes) this.add(change);
        this.changed();
        this.baseValue.set(true);
        this.phaseValue.set('ready');
      })
      .catch((error: unknown) => {
        if (request.signal.aborted || !this.current(selection, generation, vehicleId)) return;
        capture.cancel();
        this.capture = undefined;
        this.request = undefined;
        this.monitor.noteRetryAfter(error);
        this.phaseValue.set('error');
      });
  }
  private current(selection: number, generation: number, vehicleId: string): boolean {
    return (
      this.selection === selection &&
      this.selected() === vehicleId &&
      this.monitor.currentGeneration === generation
    );
  }
  private add(change: DomainChange): boolean {
    if (
      change.type !== 'telemetry.accepted' ||
      change.vehicleId !== this.selected() ||
      this.observations.has(change.eventId)
    )
      return false;
    this.observations.set(change.eventId, change.data);
    return true;
  }
  private changed(): void {
    this.revision.update((value) => value + 1);
  }
  private cancel(): void {
    this.selection += 1;
    this.request?.abort();
    this.request = undefined;
    this.capture?.cancel();
    this.capture = undefined;
    this.delay?.();
    this.delay = undefined;
  }
  ngOnDestroy(): void {
    this.close();
    for (const unsubscribe of this.unsubscribe) unsubscribe();
  }
}
