import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ReconcileIngestion } from '../../application/reconcile.js';

@Injectable()
export class IngestionReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private readonly controller = new AbortController();
  constructor(private readonly reconcile: ReconcileIngestion) {}

  onApplicationBootstrap(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
  }

  private tick(): void {
    if (this.running || this.controller.signal.aborted) return;
    this.running = this.reconcile
      .runPass(this.controller.signal)
      .then(
        (report) => {
          if (report?.unverified) console.error('RECOVERY_STATE_UNVERIFIED');
        },
        () => console.error('RECOVERY_STATE_UNAVAILABLE'),
      )
      .finally(() => {
        this.running = undefined;
      });
  }

  async onModuleDestroy(): Promise<void> {
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
