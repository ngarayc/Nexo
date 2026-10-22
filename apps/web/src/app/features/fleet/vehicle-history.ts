import { ChangeDetectionStrategy, Component, ElementRef, input, viewChildren } from '@angular/core';
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
            <tr
              #eventRow
              tabindex="-1"
              [attr.data-event-id]="event.eventId"
              [class.highlighted]="event.eventId === highlighted()"
              [attr.aria-current]="event.eventId === highlighted() ? 'true' : null"
            >
              <th scope="row">
                <nexo-identity [value]="event.eventId" />
                @if (event.eventId === highlighted()) {
                  <span class="selected-label">Observación seleccionada</span>
                }
              </th>
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
  styleUrl: '../../platform/presentation/telemetry-table.css',
})
export class VehicleHistory {
  readonly items = input.required<readonly EventView[]>();
  readonly highlighted = input<string | null>(null);
  readonly formatTime = formatTime;
  private readonly rows = viewChildren<ElementRef<HTMLTableRowElement>>('eventRow');
  focusEvent(eventId: string): boolean {
    const index = this.items().findIndex((event) => event.eventId === eventId);
    const row = this.rows()[index];
    if (!row) return false;
    row.nativeElement.focus();
    return true;
  }
}
