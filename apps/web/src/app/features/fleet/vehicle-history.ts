import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { EventView } from '@nexo/contracts';
import { IdentityText } from '../../platform/presentation/identity-text';
import { formatTime } from '../../platform/presentation/format-time';

@Component({
  selector: 'nexo-vehicle-history',
  imports: [IdentityText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="scroll"
      role="region"
      aria-label="Historial, desplazamiento horizontal"
      tabindex="0"
    >
      <table>
        <caption>
          Observaciones confirmadas en orden cronológico ascendente
        </caption>
        <thead>
          <tr>
            <th scope="col">Evento</th>
            <th scope="col">Fecha y hora (Bogotá)</th>
            <th scope="col">Velocidad (km/h)</th>
            <th scope="col">Encendido</th>
            <th scope="col">Latitud</th>
            <th scope="col">Longitud</th>
          </tr>
        </thead>
        <tbody>
          @for (event of items(); track event.eventId) {
            <tr [attr.data-event-id]="event.eventId">
              <th scope="row"><nexo-identity [value]="event.eventId" /></th>
              <td>{{ formatTime(event.observedAt) }}</td>
              <td>{{ event.speedKph }}</td>
              <td>{{ event.ignitionOn ? 'Sí' : 'No' }}</td>
              <td>{{ event.latitude }}</td>
              <td>{{ event.longitude }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: './telemetry-table.css',
})
export class VehicleHistory {
  readonly items = input.required<readonly EventView[]>();
  readonly formatTime = formatTime;
}
