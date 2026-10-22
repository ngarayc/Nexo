import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { AlertView } from '@nexo/contracts';
import { AlertsFacade } from './alerts-facade';
import { AlertsTable } from './alerts-table';
import { LiveMonitor } from '../live-monitoring/live-monitor';
import { VehicleDetailFacade } from '../fleet/vehicle-detail-facade';

@Component({
  selector: 'nexo-alerts-page',
  imports: [AlertsTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="alerts-title">
      <h2 id="alerts-title">Alertas por exceso de velocidad</h2>
      <p>Observaciones confirmadas con más de 80 km/h.</p>
      @if (monitor.hasBase()) {
        <p aria-live="polite">
          <span data-testid="alerts-view-total">{{ alerts.total() }}</span> alertas históricas
          confirmadas.
        </p>
        @if (monitor.phase() !== 'live') {
          <p>Las alertas mostradas pueden estar desactualizadas.</p>
        }
        @if (alerts.total() === 0) {
          <p>No hay alertas de exceso de velocidad.</p>
        } @else {
          <nexo-alerts-table [items]="alerts.items()" (selectEvent)="open($event)" />
        }
      } @else if (monitor.phase() === 'error') {
        <p>Las alertas no están disponibles hasta recuperar la conexión.</p>
      } @else {
        <p>Las alertas estarán disponibles al confirmar la primera carga.</p>
      }
    </section>
  `,
})
export class AlertsPage {
  readonly alerts = inject(AlertsFacade);
  readonly monitor = inject(LiveMonitor);
  private readonly detail = inject(VehicleDetailFacade);
  private readonly router = inject(Router);
  async open(alert: AlertView): Promise<void> {
    this.detail.select(alert.vehicleId, alert.eventId);
    await this.router.navigateByUrl('/');
  }
}
