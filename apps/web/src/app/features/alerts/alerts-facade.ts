import { Injectable, computed, signal } from '@angular/core';
import type { AlertView, DomainChange } from '@nexo/contracts';
import { compareViews } from '../../platform/telemetry/order';

@Injectable({ providedIn: 'root' })
export class AlertsFacade {
  private alerts = new Map<string, AlertView>();
  private readonly revision = signal(0);
  readonly items = computed(() => {
    this.revision();
    return Object.freeze([...this.alerts.values()].sort((a, b) => compareViews(b, a)));
  });
  readonly total = computed(() => {
    this.revision();
    return this.alerts.size;
  });
  install(items: readonly AlertView[]): void {
    this.alerts = new Map(items.map((view) => [view.eventId, view]));
    this.revision.update((value) => value + 1);
  }
  apply(change: DomainChange): void {
    if (change.type !== 'alert.created' || this.alerts.has(change.eventId)) return;
    const data = change.data;
    const view: AlertView = Object.freeze({
      type: 'OVERSPEED',
      eventId: data.eventId,
      vehicleId: data.vehicleId,
      observedAt: data.observedAt,
      latitude: data.latitude,
      longitude: data.longitude,
      speedKph: data.speedKph,
    });
    this.alerts.set(view.eventId, view);
    this.revision.update((value) => value + 1);
  }
  clear(): void {
    this.install([]);
  }
}
