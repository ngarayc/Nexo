import * as L from 'leaflet';
import type { MapProvider } from './map-provider-config';

export type TilePhase = 'loading' | 'ready' | 'error';

// Dos adaptadores usan la misma configuración de red, controles y ciclo de vida.
export class LeafletMapSurface {
  readonly map: L.Map;
  private readonly layer: L.TileLayer;
  private readonly observer?: ResizeObserver;

  constructor(host: HTMLElement, provider: MapProvider, tiles: (phase: TilePhase) => void) {
    this.map = L.map(host, {
      zoomControl: false,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    L.control.zoom({ zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(this.map);
    this.layer = L.tileLayer(provider.tileUrl, {
      maxZoom: provider.maxZoom,
      minZoom: 0,
      referrerPolicy: 'strict-origin-when-cross-origin',
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 0,
    });
    let failed = false;
    this.layer.on('loading', () => {
      failed = false;
      tiles('loading');
    });
    this.layer.on('tileerror', () => {
      failed = true;
      tiles('error');
    });
    this.layer.on('load', () => tiles(failed ? 'error' : 'ready'));
    this.layer.addTo(this.map);
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
      this.observer.observe(host);
    }
  }
  retryTiles(): void {
    this.layer.redraw();
  }
  destroy(): void {
    this.observer?.disconnect();
    this.map.remove();
  }
}
