import { Injectable, computed, signal } from '@angular/core';
import { compareIdentity } from '@nexo/contracts';
import type { DomainChange, VehicleView, VehicleState } from '@nexo/contracts';
import { compareViews } from '../../platform/telemetry/order';

@Injectable({ providedIn: 'root' })
export class FleetFacade {
  private vehicles = new Map<string, VehicleView>();
  private readonly revision = signal(0);
  private readonly query = signal('');
  private readonly statusValue = signal<VehicleState | null>(null);
  readonly search = this.query.asReadonly();
  readonly statusFilter = this.statusValue.asReadonly();
  readonly items = computed(() => {
    this.revision();
    return Object.freeze(
      [...this.vehicles.values()].sort((a, b) => compareIdentity(a.vehicleId, b.vehicleId)),
    );
  });
  readonly visibleItems = computed(() => {
    const search = this.query().toLowerCase();
    const status = this.statusValue();
    return search || status !== null
      ? Object.freeze(
          this.items().filter(
            (view) =>
              (status === null || view.status === status) &&
              view.vehicleId.toLowerCase().includes(search),
          ),
        )
      : this.items();
  });
  readonly total = computed(() => {
    this.revision();
    return this.vehicles.size;
  });
  readonly summary = computed(() => {
    this.revision();
    const totals: Record<VehicleState, number> = { OFF: 0, MOVING: 0, STOPPED: 0 };
    for (const view of this.vehicles.values()) totals[view.status]++;
    return Object.freeze(totals);
  });

  setSearch(value: string): void {
    this.query.set(value);
  }
  setStatus(value: VehicleState | null): void {
    this.statusValue.set(value);
  }
  clearFilters(): void {
    this.query.set('');
    this.statusValue.set(null);
  }
  get(vehicleId: string): VehicleView | undefined {
    this.revision();
    return this.vehicles.get(vehicleId);
  }
  install(items: readonly VehicleView[]): void {
    this.vehicles = new Map(items.map((view) => [view.vehicleId, view]));
    this.revision.update((value) => value + 1);
  }
  apply(change: DomainChange): void {
    if (change.type !== 'vehicle.updated') return;
    const { state, ...event } = change.data;
    const view = Object.freeze({ ...event, status: state });
    const previous = this.vehicles.get(view.vehicleId);
    if (previous && compareViews(view, previous) <= 0) return;
    this.vehicles.set(view.vehicleId, view);
    this.revision.update((value) => value + 1);
  }
  clear(): void {
    this.install([]);
    this.clearFilters();
  }
}
