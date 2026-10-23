import { Icon } from '../../platform/presentation/icon';
import { ActionTooltip } from '../../platform/presentation/action-tooltip';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { EventView } from '@nexo/contracts';
import { MapProviderStore } from '../../platform/maps/map-provider-store';
import { hasProjectionLimit } from '../../platform/maps/projection';
import type { TilePhase } from '../../platform/maps/leaflet-map-surface';
import { IdentityText } from '../../platform/presentation/identity-text';
import { formatTime } from '../../platform/presentation/format-time';
import { TRAJECTORY_FACTORY } from './adapters/trajectory-factory';
import type { TrajectoryRenderer } from './adapters/trajectory-renderer';

@Component({
  selector: 'nexo-vehicle-trajectory',
  imports: [IdentityText, Icon, ActionTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="trajectory-title">
      <div class="map-heading">
        <h3 id="trajectory-title">Trayectoria de observaciones</h3>
        <button
          class="icon-button"
          nexoTooltip="Ver trayectoria completa"
          type="button"
          (click)="fit()"
          [disabled]="!rendered() || !items().length"
        >
          <nexo-icon name="route" /><span class="sr-only">Ver trayectoria completa</span>
        </button>
      </div>
      <p>
        Las líneas unen muestras recibidas en orden cronológico. No representan una ruta calculada
        por calles ni movimiento entre muestras.
      </p>
      <p>
        {{ items().length }} observaciones, incluidas las posiciones coincidentes. Puedes elegirlas
        individualmente desde el historial.
      </p>
      @if (items().length === 0) {
        <p>No hay observaciones disponibles para representar.</p>
      }

      @if (provider.phase() === 'loading') {
        <p role="status">Preparando trayectoria…</p>
      }
      @if (provider.phase() === 'error' || tiles() === 'error') {
        <p role="status">
          No fue posible cargar la cartografía de la trayectoria. El historial sigue disponible.
        </p>
        <button
          class="icon-button"
          nexoTooltip="Reintentar mapa de trayectoria"
          type="button"
          (click)="retry()"
        >
          <nexo-icon name="refresh" /><span class="sr-only">Reintentar mapa de trayectoria</span>
        </button>
      }
      @if (projectionLimited()) {
        <p>
          Algunas latitudes superan el alcance visual de la proyección. Sus valores originales se
          conservan en el historial.
        </p>
      }
      <div class="map-wrap" [hidden]="!rendered() && !items().length">
        <div #mapHost class="map" role="region" aria-label="Mapa de trayectoria" tabindex="0"></div>
        @if (provider.provider(); as config) {
          <p class="attribution">
            <a [href]="config.attributionUrl" target="_blank" rel="noopener noreferrer">{{
              config.attribution
            }}</a>
          </p>
        }
      </div>
      <p class="external">
        La cartografía requiere Internet y contacta al proveedor para cargar el área visible.
      </p>
      @if (observation(); as event) {
        <section aria-labelledby="selected-observation-title" class="observation">
          <h4 id="selected-observation-title">Observación seleccionada</h4>
          <nexo-identity [value]="event.eventId" />
          <dl>
            <dt>Fecha y hora</dt>
            <dd>{{ formatTime(event.observedAt) }}</dd>
            <dt>Velocidad recibida</dt>
            <dd>{{ event.speedKph }} km/h</dd>
            <dt>Encendido</dt>
            <dd>{{ event.ignitionOn ? 'Sí' : 'No' }}</dd>
            <dt>Latitud original</dt>
            <dd>{{ event.latitude }}</dd>
            <dt>Longitud original</dt>
            <dd>{{ event.longitude }}</dd>
          </dl>
        </section>
      } @else if (selected() !== null) {
        <p>La observación seleccionada no aparece en el historial disponible.</p>
      } @else {
        <p>Selecciona una observación del mapa o del historial para ver sus valores originales.</p>
      }
    </section>
  `,
  styleUrl: './map-panel.css',
})
export class VehicleTrajectory {
  readonly vehicleId = input.required<string>();
  readonly items = input.required<readonly EventView[]>();
  readonly selected = input<string | null>(null);
  readonly selectEvent = output<string>();
  readonly provider = inject(MapProviderStore);
  readonly rendered = signal(false);
  readonly tiles = signal<TilePhase>('loading');
  readonly observation = computed(() =>
    this.items().find((event) => event.eventId === this.selected()),
  );
  readonly projectionLimited = computed(() => hasProjectionLimit(this.items()));
  readonly formatTime = formatTime;
  private readonly host = viewChild<ElementRef<HTMLElement>>('mapHost');
  private readonly factory = inject(TRAJECTORY_FACTORY);
  private renderer?: TrajectoryRenderer;

  constructor() {
    this.provider.load();
    afterRenderEffect(() => {
      const host = this.host()?.nativeElement;
      const provider = this.provider.provider();
      const events = this.items(),
        vehicle = this.vehicleId(),
        selected = this.selected();
      if (!host || !provider || (!this.renderer && !events.length)) return;
      if (!this.renderer) {
        this.renderer = this.factory(
          host,
          provider,
          (id) => this.selectEvent.emit(id),
          (phase) => this.tiles.set(phase),
        );
        this.rendered.set(true);
      }
      this.renderer.sync(vehicle, events, selected);
    });
    inject(DestroyRef).onDestroy(() => this.renderer?.destroy());
  }
  fit(): void {
    this.renderer?.fit();
  }
  focusEvent(id: string): void {
    this.renderer?.focusEvent(id);
  }
  retry(): void {
    if (this.provider.phase() === 'error') this.provider.load();
    else this.renderer?.retryTiles();
  }
}
