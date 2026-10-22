import { OutboxReadiness } from './dispatch.js';

export class RealtimeAvailability {
  private active = false;
  private served = false;
  private readonly observers = new Set<() => void>();
  constructor(
    private readonly readiness: OutboxReadiness,
    private readonly renewInstance: () => void,
  ) {}
  onDegraded(observer: () => void): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }
  get healthy(): boolean {
    const next = this.readiness.healthy;
    if (next !== this.active) {
      this.active = next;
      if (next) {
        if (this.served) this.renewInstance();
        this.served = true;
      } else {
        for (const observer of this.observers) observer();
      }
    }
    return next;
  }
}
