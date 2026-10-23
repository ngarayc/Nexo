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
  imports: [IdentityText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="trajectory-title">
      <h3 id="trajectory-title">Trayectoria de observaciones</h3>
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
      <button type="button" (click)="fit()" [disabled]="!rendered() || !items().length">
        Ver trayectoria completa
      </button>
      @if (provider.phase() === 'loading') {
        <p role="status">Preparando trayectoria…</p>
      }
      @if (provider.phase() === 'error' || tiles() === 'error') {
        <p role="status">
          No fue posible cargar la cartografía de la trayectoria. El historial sigue disponible.
        </p>
        <button type="button" (click)="retry()">Reintentar mapa de trayectoria</button>
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
  styles: `
    :host {
      display: block;
      min-width: 0;
      margin-block: 1.5rem;
    }
    .map-wrap {
      position: relative;
      margin-block: 0.75rem;
    }
    .map {
      width: 100%;
      height: clamp(16rem, 42vh, 28rem);
      background: #e7efec;
    }
    .attribution {
      position: absolute;
      right: 0;
      bottom: 0;
      z-index: 900;
      max-width: 90%;
      margin: 0;
      padding: 0.3rem;
      background: white;
      font-size: 0.75rem;
      overflow-wrap: anywhere;
    }
    .external {
      color: #526970;
      font-size: 0.875rem;
    }
    button {
      padding: 0.6rem;
      font: inherit;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
      gap: 0.5rem;
    }
    dt {
      font-weight: 600;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .observation {
      padding: 0.75rem;
      background: #f5f8f8;
    }
  `,
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
