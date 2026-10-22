import { Injectable, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { DomainChange, StreamControl, ReplayStreamFrame } from '@nexo/contracts';
import { SessionState } from '../../platform/session/session-state';
import { SessionApi } from '../access/data-access/session-api';
import { TelemetryApi } from '../../platform/telemetry/telemetry-api';
import { CaptureBudget, ObsoleteCapture } from '../../platform/telemetry/capture-budget';
import type { CaptureHandle } from '../../platform/telemetry/capture-budget';
import type { DomainFrame } from '../../platform/telemetry/telemetry-contract';
import { STREAM_TRANSPORT, LIVE_CLOCK } from '../../platform/telemetry/stream-transport';
import type { StreamHandle } from '../../platform/telemetry/stream-transport';
import { RecentMessages } from '../../platform/telemetry/recent-messages';
import { FleetFacade } from '../fleet/fleet-facade';
import { AlertsFacade } from '../alerts/alerts-facade';

export type LivePhase = 'idle' | 'loading' | 'live' | 'reconnecting' | 'error';
const waits = [2000, 4000, 8000, 16000, 30000] as const;

@Injectable({ providedIn: 'root' })
export class LiveMonitor implements OnDestroy {
  private readonly sessions = inject(SessionState);
  private readonly access = inject(SessionApi);
  private readonly api = inject(TelemetryApi);
  private readonly transport = inject(STREAM_TRANSPORT);
  private readonly clock = inject(LIVE_CLOCK);
  private readonly fleet = inject(FleetFacade);
  private readonly alerts = inject(AlertsFacade);
  private readonly phaseValue = signal<LivePhase>('idle');
  private readonly baseValue = signal(false);
  private readonly syncValue = signal<number | null>(null);
  readonly phase = this.phaseValue.asReadonly();
  readonly hasBase = this.baseValue.asReadonly();
  readonly lastSynchronizedAt = this.syncValue.asReadonly();
  private readonly budget = new CaptureBudget();
  private readonly recent = new RecentMessages();
  private readonly invalidated = new Set<(clear: boolean) => void>();
  private readonly ready = new Set<(generation: number) => void>();
  private readonly frames = new Set<(change: DomainChange) => void>();
  private readonly replays = new Set<(view: ReplayStreamFrame, generation: number) => void>();
  private authEpoch: number | undefined;
  private generation = 0;
  private retries = 0;
  private nextAllowed = 0;
  private instance: string | undefined;
  private stream: StreamHandle | undefined;
  private request: AbortController | undefined;
  private snapshotCapture: CaptureHandle | undefined;
  private resumeListener: (() => void) | undefined;
  private readyTimer: (() => void) | undefined;
  private silenceTimer: (() => void) | undefined;
  private retryTimer: (() => void) | undefined;
  private healthyTimer: (() => void) | undefined;
  private openedAt = 0;
  private lastSeen = 0;
  private lastSeenWall = 0;
  private destroyed = false;
  private readonly watch = effect(() => {
    this.sessions.session();
    untracked(() => this.reconcileSession());
  });

  get currentGeneration(): number | undefined {
    return this.phase() === 'live' && this.authorized() && this.stream?.open
      ? this.generation
      : undefined;
  }
  onInvalidated(listener: (clear: boolean) => void): () => void {
    this.invalidated.add(listener);
    return () => this.invalidated.delete(listener);
  }
  onReady(listener: (generation: number) => void): () => void {
    this.ready.add(listener);
    const current = this.currentGeneration;
    if (current !== undefined) listener(current);
    return () => this.ready.delete(listener);
  }
  onFrame(listener: (change: DomainChange) => void): () => void {
    this.frames.add(listener);
    return () => this.frames.delete(listener);
  }
  onReplay(listener: (view: ReplayStreamFrame, generation: number) => void): () => void {
    this.replays.add(listener);
    return () => this.replays.delete(listener);
  }
  capture(accepts: (change: DomainChange) => boolean): CaptureHandle {
    if (this.currentGeneration === undefined) throw new ObsoleteCapture();
    return this.budget.begin(accepts);
  }
  reconnect(): void {
    this.reconcileSession();
    if (!this.authorized()) return;
    this.invalidate(false);
    this.retries = 0;
    this.phaseValue.set(this.hasBase() ? 'reconnecting' : 'loading');
    this.scheduleStart(this.retryWait, true);
  }
  get retryWait(): number {
    return Math.max(0, this.nextAllowed - this.clock.now());
  }
  noteRetryAfter(error: unknown): number {
    if (!(error instanceof HttpErrorResponse)) return this.retryWait;
    const value = error.headers.get('Retry-After');
    if (!value) return this.retryWait;
    let delay = 0;
    if (/^\d+$/.test(value)) delay = Number(value) * 1000;
    else if (/^[A-Za-z]{3}, /.test(value)) {
      const deadline = Date.parse(value);
      if (!Number.isFinite(deadline)) return this.retryWait;
      delay = Math.max(0, deadline - this.clock.wall());
    }
    if (!Number.isFinite(delay) || delay > 2147483647) this.nextAllowed = Infinity;
    else if (delay > 0) this.nextAllowed = Math.max(this.nextAllowed, this.clock.now() + delay);
    return this.retryWait;
  }

  private authorized(): boolean {
    const session = this.sessions.session();
    return (
      !this.destroyed &&
      this.authEpoch !== undefined &&
      this.authEpoch === this.sessions.epoch &&
      session !== null &&
      Date.parse(session.expiresAt) > this.clock.wall()
    );
  }
  private current(generation: number): boolean {
    return generation === this.generation && this.authorized();
  }
  private reconcileSession(): void {
    if (this.destroyed) return;
    const session = this.sessions.session();
    if (!session || Date.parse(session.expiresAt) <= this.clock.wall()) {
      if (session) this.sessions.expire();
      if (this.authEpoch !== undefined) {
        this.invalidate(true);
        this.authEpoch = undefined;
        this.resumeListener?.();
        this.resumeListener = undefined;
      }
      this.phaseValue.set('idle');
      return;
    }
    if (this.authEpoch === this.sessions.epoch) return;
    this.invalidate(true);
    this.resumeListener?.();
    this.authEpoch = this.sessions.epoch;
    this.retries = 0;
    this.resumeListener = this.transport.onResume(() => this.resumed());
    this.phaseValue.set('loading');
    this.scheduleStart(this.retryWait, false);
  }
  private scheduleStart(delay: number, verify: boolean): void {
    if (!Number.isFinite(delay)) {
      this.phaseValue.set('error');
      return;
    }
    const generation = this.generation;
    this.retryTimer?.();
    if (delay <= 0) {
      void this.start(generation, verify);
      return;
    }
    this.retryTimer = this.clock.after(delay, () => {
      this.retryTimer = undefined;
      if (this.current(generation)) void this.start(generation, verify);
    });
  }
  private async start(generation: number, verify: boolean): Promise<void> {
    if (!this.current(generation)) return;
    const request = new AbortController();
    this.request = request;
    if (verify) {
      try {
        const snapshot = await this.access.current(request.signal);
        if (!this.current(generation)) return;
        if (!this.sessions.accept(snapshot, this.authEpoch!)) this.sessions.expire();
        this.reconcileSession();
        if (!this.current(generation)) return;
      } catch (error) {
        if (!request.signal.aborted) this.failed(generation, error);
        return;
      }
    }
    try {
      this.openedAt = this.clock.now();
      this.touch(generation);
      this.stream = this.transport.connect({
        control: (control) => this.control(generation, control),
        frame: (frame) => this.frame(generation, frame),
        replay: (view) => {
          if (!this.current(generation)) return;
          if (this.instance === undefined || view.streamInstanceId !== this.instance) {
            this.failed(generation);
            return;
          }
          for (const listener of this.replays) listener(view, generation);
        },
        failed: () => this.failed(generation),
      });
      this.readyTimer = this.clock.after(10000, () => this.failed(generation));
    } catch (error) {
      this.failed(generation, error);
    }
  }
  private control(generation: number, control: StreamControl): void {
    if (!this.current(generation)) return;
    if (control.type === 'stream.ready') {
      if (this.instance !== undefined) {
        this.failed(generation);
        return;
      }
      this.instance = control.instanceId;
      this.readyTimer?.();
      this.readyTimer = undefined;
      this.touch(generation);
      const capture = this.budget.begin();
      this.snapshotCapture = capture;
      const signal = this.request!.signal;
      void this.api
        .snapshot(signal)
        .then((snapshot) => {
          if (!this.current(generation) || signal.aborted) return;
          if (
            !this.stream?.open ||
            snapshot.instanceId !== this.instance ||
            snapshot.schemaVersion !== 1
          ) {
            this.failed(generation);
            return;
          }
          const changes = capture.take();
          this.snapshotCapture = undefined;
          this.fleet.install(snapshot.vehicles.items);
          this.alerts.install(snapshot.alerts.items);
          for (const change of changes) this.apply(change);
          this.baseValue.set(true);
          this.syncValue.set(this.clock.wall());
          this.phaseValue.set('live');
          this.healthyTimer = this.clock.after(30000, () => {
            if (this.currentGeneration === generation && this.silence() < 45000) this.retries = 0;
          });
          for (const listener of this.ready) listener(generation);
        })
        .catch((error) => {
          if (!signal.aborted) this.failed(generation, error);
        });
      return;
    }
    if (
      this.instance === undefined ||
      control.instanceId !== this.instance ||
      control.type === 'stream.resync-required'
    ) {
      this.failed(generation);
      return;
    }
    this.touch(generation);
  }
  private frame(generation: number, frame: DomainFrame): void {
    if (!this.current(generation)) return;
    if (this.instance === undefined) {
      this.failed(generation);
      return;
    }
    this.touch(generation);
    if (this.recent.remember(frame.change.messageId)) return;
    try {
      this.budget.push(frame);
      if (!this.snapshotCapture) this.apply(frame.change);
    } catch (error) {
      this.failed(generation, error);
    }
  }
  private apply(change: DomainChange): void {
    this.fleet.apply(change);
    this.alerts.apply(change);
    for (const listener of this.frames) listener(change);
  }
  private silence(): number {
    return Math.max(this.clock.now() - this.lastSeen, this.clock.wall() - this.lastSeenWall);
  }
  private touch(generation: number): void {
    this.lastSeen = this.clock.now();
    this.lastSeenWall = this.clock.wall();
    this.silenceTimer?.();
    this.silenceTimer = this.clock.after(45000, () => {
      if (this.current(generation)) this.failed(generation);
    });
  }
  private resumed(): void {
    this.reconcileSession();
    if (!this.authorized() || this.phase() === 'error') return;
    if (this.phase() === 'live' && (!this.stream?.open || this.silence() >= 45000))
      this.failed(this.generation);
    else if (
      this.instance === undefined &&
      this.stream &&
      Math.max(this.clock.now() - this.openedAt, this.clock.wall() - this.lastSeenWall) >= 10000
    )
      this.failed(this.generation);
  }
  private failed(generation: number, error?: unknown): void {
    if (generation !== this.generation || this.destroyed) return;
    if (
      error instanceof HttpErrorResponse &&
      error.status === 403 &&
      error.error?.code === 'SESSION_REQUIRED' &&
      this.authEpoch === this.sessions.epoch
    )
      this.sessions.expire();
    this.reconcileSession();
    if (!this.current(generation)) return;
    this.noteRetryAfter(error);
    this.invalidate(false);
    this.phaseValue.set(this.hasBase() ? 'reconnecting' : 'loading');
    if (this.retries >= waits.length) {
      this.phaseValue.set('error');
      return;
    }
    const base = waits[this.retries++]!;
    const delay = Math.max(
      this.retryWait,
      Math.min(30000, base * (1 + this.clock.random() * 0.25)),
    );
    this.scheduleStart(delay, true);
  }
  private invalidate(clear: boolean): void {
    this.generation += 1;
    this.request?.abort();
    this.request = undefined;
    this.stream?.close();
    this.stream = undefined;
    this.readyTimer?.();
    this.silenceTimer?.();
    this.healthyTimer?.();
    this.retryTimer?.();
    this.readyTimer = this.silenceTimer = this.healthyTimer = this.retryTimer = undefined;
    this.budget.clear();
    this.snapshotCapture = undefined;
    this.instance = undefined;
    this.recent.clear();
    for (const listener of this.invalidated) listener(clear);
    if (clear) {
      this.fleet.clear();
      this.alerts.clear();
      this.baseValue.set(false);
      this.syncValue.set(null);
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.watch.destroy();
    this.invalidate(true);
    this.resumeListener?.();
    this.ready.clear();
    this.frames.clear();
    this.replays.clear();
    this.invalidated.clear();
  }
}
