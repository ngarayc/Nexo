import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { FleetFacade } from './fleet-facade';
import { VehicleDetailFacade } from './vehicle-detail-facade';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { IdentityText } from '../../platform/presentation/identity-text';
import { FleetTable } from './fleet-table';
import { VehicleHistory } from './vehicle-history';

@Component({
  selector: 'nexo-fleet-page',
  imports: [FleetTable, VehicleHistory, IdentityText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fleet-page.html',
  styleUrl: './fleet-page.css',
})
export class FleetPage {
  readonly fleet = inject(FleetFacade);
  readonly detail = inject(VehicleDetailFacade);
  readonly monitor = inject(LiveMonitor);
  private readonly injector = inject(Injector);
  private readonly history = viewChild<ElementRef<HTMLElement>>('historyPanel');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly table = viewChild(FleetTable);

  open(vehicleId: string): void {
    this.detail.select(vehicleId);
    afterNextRender(() => this.history()?.nativeElement.focus(), { injector: this.injector });
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
