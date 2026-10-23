import { Icon } from '../../platform/presentation/icon';
import { ActionTooltip } from '../../platform/presentation/action-tooltip';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { AlertView } from '@nexo/contracts';
import { AlertsFilterFacade } from './alerts-filter-facade';
import { AlertsTable } from './alerts-table';
import { IdentityText } from '../../platform/presentation/identity-text';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { VehicleDetailFacade } from '../fleet/vehicle-detail-facade';

@Component({
  selector: 'nexo-alerts-page',
  imports: [AlertsTable, IdentityText, FormsModule, Icon, ActionTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="alerts-title">
      <header class="section-heading">
        <div>
          <p class="eyebrow">SUPERVISIÓN DE EVENTOS</p>
          <h2 id="alerts-title">Alertas por exceso de velocidad</h2>
        </div>
        <span class="section-mark" aria-hidden="true"><nexo-icon name="alert" /></span>
      </header>
      <p>Observaciones confirmadas con más de 80 km/h.</p>
      @if (monitor.hasBase()) {
        <div class="filter">
          <label for="alerts-vehicle">Filtrar por vehículo</label>
          <select
            #vehicleFilter
            id="alerts-vehicle"
            aria-describedby="alerts-filter-description"
            [ngModel]="filter.selectionKey()"
            (ngModelChange)="filter.selectKey($event)"
          >
            <option [value]="filter.allKey">Todos los vehículos</option>
            @for (option of filter.options(); track option.key) {
              <option [value]="option.key" [label]="option.label">
                {{ option.label }}
              </option>
            }
          </select>
          <p id="alerts-filter-description">El total general incluye todos los vehículos.</p>
          @if (filter.vehicleId(); as vehicleId) {
            <p>Vehículo seleccionado: <nexo-identity [value]="vehicleId" /></p>
            <button
              class="icon-button"
              nexoTooltip="Mostrar todos"
              type="button"
              (click)="showAll(vehicleFilter)"
            >
              <nexo-icon name="filter" /><span class="sr-only">Mostrar todos</span>
            </button>
          }
        </div>
        <p aria-live="polite">
          <span data-testid="alerts-view-total">{{ filter.total() }}</span> de
          <span data-testid="alerts-global-total">{{ filter.overallTotal() }}</span> alertas
          históricas confirmadas.
        </p>
        @if (monitor.phase() !== 'live') {
          <p>Las alertas mostradas pueden estar desactualizadas.</p>
        }
        @if (filter.missing()) {
          <p>El vehículo seleccionado ya no aparece en la flota mostrada.</p>
        }
        @if (filter.overallTotal() === 0) {
          <p>No hay alertas de exceso de velocidad.</p>
        } @else if (filter.total() === 0) {
          <p>Este vehículo no tiene alertas confirmadas.</p>
        } @else {
          <nexo-alerts-table [items]="filter.items()" (selectEvent)="open($event)" />
        }
      } @else if (monitor.phase() === 'error') {
        <p>Las alertas no están disponibles hasta recuperar la conexión.</p>
      } @else {
        <p>Las alertas estarán disponibles al confirmar la primera carga.</p>
      }
    </section>
  `,
  styleUrl: './alerts-page.css',
})
export class AlertsPage {
  readonly filter = inject(AlertsFilterFacade);
  readonly monitor = inject(LiveMonitor);
  private readonly detail = inject(VehicleDetailFacade);
  private readonly router = inject(Router);
  showAll(select: HTMLSelectElement): void {
    this.filter.showAll();
    select.focus();
  }
  async open(alert: AlertView): Promise<void> {
    this.detail.select(alert.vehicleId, alert.eventId);
    await this.router.navigateByUrl('/');
  }
}
