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
import type { VehicleView } from '@nexo/contracts';
import { MapProviderStore } from '../../platform/maps/map-provider-store';
import { hasProjectionLimit } from '../../platform/maps/projection';
import { FLEET_MAP_FACTORY } from './adapters/fleet-map-factory';
import type { FleetMapRenderer, TilePhase } from './adapters/fleet-map-renderer';

@Component({
  selector: 'nexo-fleet-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="fleet-map-title">
      <h3 id="fleet-map-title">Últimas posiciones</h3>
      <p>Selecciona un vehículo en el mapa o en la tabla para abrir su historial.</p>
      <button type="button" (click)="fit()" [disabled]="!rendered() || items().length === 0">
        Ver flota visible
      </button>
      @if (provider.phase() === 'loading') {
        <p role="status">Preparando mapa…</p>
      }
      @if (provider.phase() === 'error' || tiles() === 'error') {
        <p role="status">
          No fue posible cargar la cartografía. La tabla y el historial siguen disponibles.
        </p>
        <button type="button" (click)="retry()">Reintentar mapa</button>
      }
      @if (items().length === 0) {
        <p>No hay posiciones de vehículos visibles en el mapa.</p>
      }
      @if (projectionLimited()) {
        <p>
          Algunas latitudes superan el alcance visual de la proyección. Sus valores originales se
          conservan en la tabla y el historial.
        </p>
      }
      <div class="map-wrap" [hidden]="!rendered() && items().length === 0">
        <div
          #mapHost
          class="map"
          role="region"
          aria-label="Mapa de últimas posiciones"
          tabindex="0"
        ></div>
        @if (provider.provider(); as config) {
          <p class="attribution">
            <a [href]="config.attributionUrl" target="_blank" rel="noopener noreferrer">{{
              config.attribution
            }}</a>
          </p>
        }
      </div>
      <p class="external">
        El mapa base requiere Internet y contacta al proveedor cartográfico para cargar el área
        visible.
      </p>
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
      height: clamp(16rem, 42vh, 28rem);
      width: 100%;
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
  `,
})
export class FleetMap {
  readonly items = input.required<readonly VehicleView[]>();
  readonly selected = input<string | null>(null);
  readonly selectVehicle = output<string>();
  readonly provider = inject(MapProviderStore);
  readonly rendered = signal(false);
  readonly tiles = signal<TilePhase>('loading');
  readonly projectionLimited = computed(() => hasProjectionLimit(this.items()));
  private readonly host = viewChild<ElementRef<HTMLElement>>('mapHost');
  private readonly factory = inject(FLEET_MAP_FACTORY);
  private renderer?: FleetMapRenderer;

  constructor() {
    this.provider.load();
    afterRenderEffect(() => {
      const host = this.host()?.nativeElement;
      const provider = this.provider.provider();
      const items = this.items(),
        selected = this.selected();
      if (!host || !provider || (!this.renderer && !items.length)) return;
      if (!this.renderer) {
        this.renderer = this.factory(
          host,
          provider,
          (id) => this.selectVehicle.emit(id),
          (phase) => this.tiles.set(phase),
        );
        this.rendered.set(true);
      }
      this.renderer.sync(items, selected);
    });
    inject(DestroyRef).onDestroy(() => this.renderer?.destroy());
  }
  fit(): void {
    this.renderer?.fit();
  }
  focusVehicle(id: string): void {
    this.renderer?.focusVehicle(id);
  }
  retry(): void {
    if (this.provider.phase() === 'error') this.provider.load();
    else this.renderer?.retryTiles();
  }
}
