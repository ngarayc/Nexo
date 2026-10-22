import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  inject,
  computed,
  viewChild,
} from '@angular/core';
import type { VehicleState } from '@nexo/contracts';
import { FleetFacade } from './fleet-facade';
import { VehicleDetailFacade } from './vehicle-detail-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { IdentityText } from '../../platform/presentation/identity-text';
import { FleetTable } from './fleet-table';
import { VehicleHistory } from './vehicle-history';
import { FleetMap } from './fleet-map';

@Component({
  selector: 'nexo-fleet-page',
  imports: [FleetTable, VehicleHistory, IdentityText, FleetMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fleet-page.html',
  styleUrl: './fleet-page.css',
})
export class FleetPage {
  readonly fleet = inject(FleetFacade);
  readonly detail = inject(VehicleDetailFacade);
  readonly monitor = inject(LiveMonitor);
  readonly stateFilters: readonly { value: VehicleState | null; label: string }[] = [
    { value: null, label: 'Todos' },
    { value: 'MOVING', label: 'En movimiento' },
    { value: 'STOPPED', label: 'Detenidos' },
    { value: 'OFF', label: 'Apagados' },
  ];
  readonly hiddenSelection = computed(() => {
    const id = this.detail.selected();
    return (
      id !== null &&
      this.fleet.get(id) !== undefined &&
      !this.fleet.visibleItems().some((vehicle) => vehicle.vehicleId === id)
    );
  });
  private readonly injector = inject(Injector);
  private readonly history = viewChild<ElementRef<HTMLElement>>('historyPanel');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly table = viewChild(FleetTable);
  private readonly historyTable = viewChild(VehicleHistory);
  private readonly map = viewChild(FleetMap);
  private lastFocusedEvent: string | null = null;
  constructor() {
    afterRenderEffect(() => {
      const id = this.detail.focusedEvent();
      const event = this.detail.focusedObservation();
      const phase = this.detail.phase();
      if (id === null) this.lastFocusedEvent = null;
      if (!event || phase !== 'ready' || this.lastFocusedEvent === id) return;
      this.lastFocusedEvent = id;
      this.historyTable()?.focusEvent(event.eventId);
    });
  }

  open(vehicleId: string): void {
    this.detail.select(vehicleId);
    this.map()?.focusVehicle(vehicleId);
    afterNextRender(() => this.history()?.nativeElement.focus(), { injector: this.injector });
  }
  clearFilters(): void {
    this.fleet.clearFilters();
    afterNextRender(() => this.search()?.nativeElement.focus(), { injector: this.injector });
  }
  close(): void {
    const previous = this.detail.selected();
    this.detail.close();
    afterNextRender(
      () => {
        if (previous === null || !this.table()?.focusVehicle(previous))
          this.search()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
