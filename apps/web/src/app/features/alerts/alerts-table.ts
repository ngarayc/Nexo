import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { AlertView } from '@nexo/contracts';
import { IdentityText, identityPreview } from '../../platform/presentation/identity-text';
import { formatTime } from '../../platform/presentation/format-time';

@Component({
  selector: 'nexo-alerts-table',
  imports: [IdentityText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="scroll"
      role="region"
      aria-label="Alertas históricas, desplazamiento horizontal"
      tabindex="0"
    >
      <table>
        <caption>
          Excesos de velocidad confirmados, del más reciente al más antiguo
        </caption>
        <thead>
          <tr>
            <th scope="col">Evento</th>
            <th scope="col">Vehículo</th>
            <th scope="col">Fecha y hora (Bogotá)</th>
            <th scope="col">Velocidad (km/h)</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          @for (alert of items(); track alert.eventId) {
            <tr [attr.data-event-id]="alert.eventId" [attr.data-vehicle-id]="alert.vehicleId">
              <th scope="row"><nexo-identity [value]="alert.eventId" /></th>
              <td><nexo-identity [value]="alert.vehicleId" /></td>
              <td>{{ formatTime(alert.observedAt) }}</td>
              <td>{{ alert.speedKph }}</td>
              <td>
                <button
                  type="button"
                  (click)="selectEvent.emit(alert)"
                  [attr.aria-label]="'Ver evento ' + preview(alert.eventId)"
                >
                  Ver evento
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
export class AlertsTable {
  readonly items = input.required<readonly AlertView[]>();
  readonly selectEvent = output<AlertView>();
  readonly formatTime = formatTime;
  readonly preview = identityPreview;
}
