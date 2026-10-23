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
import type { VehicleView } from '@nexo/contracts';
import { MapProviderStore } from '../../platform/maps/map-provider-store';
import { hasProjectionLimit } from '../../platform/maps/projection';
import { FLEET_MAP_FACTORY } from './adapters/fleet-map-factory';
import type { FleetMapRenderer, TilePhase } from './adapters/fleet-map-renderer';

@Component({
  imports: [Icon, ActionTooltip],
  selector: 'nexo-fleet-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="fleet-map-title">
      <div class="map-heading">
        <h3 id="fleet-map-title">Últimas posiciones</h3>
        <button
          class="icon-button"
          nexoTooltip="Ver flota visible"
          type="button"
          (click)="fit()"
          [disabled]="!rendered() || items().length === 0"
        >
          <nexo-icon name="focus" /><span class="sr-only">Ver flota visible</span>
        </button>
      </div>
      <p>Selecciona un vehículo en el mapa o en la tabla para abrir su historial.</p>

      @if (provider.phase() === 'loading') {
        <p role="status">Preparando mapa…</p>
      }
      @if (provider.phase() === 'error' || tiles() === 'error') {
        <p role="status">
          No fue posible cargar la cartografía. La tabla y el historial siguen disponibles.
        </p>
        <button class="icon-button" nexoTooltip="Reintentar mapa" type="button" (click)="retry()">
          <nexo-icon name="refresh" /><span class="sr-only">Reintentar mapa</span>
        </button>
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
  styleUrl: './map-panel.css',
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
