import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';
import type { VehicleView, VehicleState } from '@nexo/contracts';
import { IdentityText, identityPreview } from '../../platform/presentation/identity-text';
import { formatTime } from '../../platform/presentation/format-time';

export const stateLabels: Readonly<Record<VehicleState, string>> = {
  OFF: 'Apagado',
  MOVING: 'En movimiento',
  STOPPED: 'Detenido',
};
@Component({
  selector: 'nexo-fleet-table',
  imports: [IdentityText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="scroll"
      role="region"
      aria-label="Tabla de vehículos, desplazamiento horizontal"
      tabindex="0"
    >
      <table>
        <caption>
          Último estado confirmado de los vehículos
        </caption>
        <thead>
          <tr>
            <th scope="col">Vehículo</th>
            <th scope="col">Última observación (Bogotá)</th>
            <th scope="col">Velocidad (km/h)</th>
            <th scope="col">Encendido</th>
            <th scope="col">Estado</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          @for (vehicle of items(); track vehicle.vehicleId) {
            <tr
              [class.selected]="vehicle.vehicleId === selected()"
              [attr.data-vehicle-id]="vehicle.vehicleId"
              [attr.data-event-id]="vehicle.eventId"
            >
              <th scope="row"><nexo-identity [value]="vehicle.vehicleId" /></th>
              <td>{{ formatTime(vehicle.observedAt) }}</td>
              <td>{{ vehicle.speedKph }}</td>
              <td>{{ vehicle.ignitionOn ? 'Sí' : 'No' }}</td>
              <td>
                <span class="state" [class]="'state ' + vehicle.status">{{
                  labels[vehicle.status]
                }}</span>
              </td>
              <td>
                <button
                  #historyButton
                  type="button"
                  (click)="selectVehicle.emit(vehicle.vehicleId)"
                  [attr.aria-label]="'Ver historial de ' + preview(vehicle.vehicleId)"
                  [attr.aria-expanded]="vehicle.vehicleId === selected()"
                  [attr.aria-controls]="vehicle.vehicleId === selected() ? 'vehicle-history' : null"
                >
                  Ver historial
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: '../../platform/presentation/telemetry-table.css',
})
export class FleetTable {
  readonly items = input.required<readonly VehicleView[]>();
  readonly selected = input<string | null>(null);
  readonly selectVehicle = output<string>();
  readonly formatTime = formatTime;
  readonly preview = identityPreview;
  readonly labels = stateLabels;
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('historyButton');
  focusVehicle(vehicleId: string): boolean {
    const index = this.items().findIndex((vehicle) => vehicle.vehicleId === vehicleId);
    const button = this.buttons()[index];
    if (!button) return false;
    button.nativeElement.focus();
    return true;
  }
}
