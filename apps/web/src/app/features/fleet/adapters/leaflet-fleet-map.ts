import * as L from 'leaflet';
import type { VehicleView } from '@nexo/contracts';
import type { MapProvider } from '../../../platform/maps/map-provider-config';
import { formatIdentity, identityPreview } from '../../../platform/presentation/identity-text';
import { formatTime } from '../../../platform/presentation/format-time';
import { stateLabels } from '../../../platform/presentation/vehicle-state-label';
import type { FleetMapFactory, FleetMapRenderer, TilePhase } from './fleet-map-renderer';

const symbols = { MOVING: '▶', STOPPED: '■', OFF: '○' } as const;

function description(vehicle: VehicleView): string {
  return `${stateLabels[vehicle.status]} · ${vehicle.speedKph} km/h · ${formatTime(vehicle.observedAt)}`;
}

function tooltip(vehicle: VehicleView): HTMLElement {
  const node = document.createElement('div');
  const identity = document.createElement('strong');
  identity.textContent = 'Vehículo ' + identityPreview(vehicle.vehicleId);
  const details = document.createElement('p');
  details.textContent = description(vehicle);
  node.append(identity, details);
  return node;
}

class LeafletFleetMap implements FleetMapRenderer {
  private readonly map: L.Map;
  private readonly layer: L.TileLayer;
  private readonly observer?: ResizeObserver;
  private readonly markers = new Map<
    string,
    { marker: L.Marker; symbol: HTMLElement; view: VehicleView }
  >();
  private vehicles: readonly VehicleView[] = [];
  private initiallyFitted = false;
  private previousSelection: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly provider: MapProvider,
    private readonly select: (id: string) => void,
    tiles: (phase: TilePhase) => void,
  ) {
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

  sync(vehicles: readonly VehicleView[], selected: string | null): void {
    this.vehicles = vehicles;
    if (!this.initiallyFitted && vehicles.length > 0) {
      this.fit();
      this.initiallyFitted = true;
    }
    const visible = new Set(vehicles.map((vehicle) => vehicle.vehicleId));
    for (const [id, entry] of this.markers) {
      if (visible.has(id)) continue;
      const element = entry.marker.getElement();
      const focused = element?.contains(document.activeElement);
      entry.marker.remove();
      this.markers.delete(id);
      if (focused) this.host.focus();
    }
    for (const vehicle of vehicles) {
      let entry = this.markers.get(vehicle.vehicleId);
      if (!entry) {
        const symbol = document.createElement('span');
        const marker = L.marker([vehicle.latitude, vehicle.longitude], {
          keyboard: true,
          autoPanOnFocus: true,
          icon: L.divIcon({
            html: symbol,
            className: 'nexo-fleet-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        }).addTo(this.map);
        marker.on('click', () => this.select(vehicle.vehicleId));
        marker.on('keydown', (event: L.LeafletKeyboardEvent) => {
          if (!['Enter', ' '].includes(event.originalEvent.key)) return;
          L.DomEvent.stop(event.originalEvent);
          if (!event.originalEvent.repeat) this.select(vehicle.vehicleId);
        });
        entry = { marker, symbol, view: vehicle };
        this.markers.set(vehicle.vehicleId, entry);
        marker.bindTooltip(tooltip(vehicle), { direction: 'top', className: 'nexo-fleet-tooltip' });
      } else if (entry.view !== vehicle) {
        entry.marker.setLatLng([vehicle.latitude, vehicle.longitude]);
        entry.marker.setTooltipContent(tooltip(vehicle));
        entry.view = vehicle;
      }
      entry.symbol.textContent = symbols[vehicle.status];
      const element = entry.marker.getElement();
      if (element) {
        element.setAttribute(
          'aria-label',
          `Vehículo ${formatIdentity(vehicle.vehicleId)} · ${description(vehicle)}`,
        );
        element.classList.toggle('is-selected', vehicle.vehicleId === selected);
      }
    }
    if (selected !== null && selected !== this.previousSelection) this.focusVehicle(selected);
    this.previousSelection = selected;
  }
  fit(): void {
    if (!this.vehicles.length) return;
    this.map.invalidateSize({ pan: false });
    this.map.fitBounds(
      L.latLngBounds(this.vehicles.map((v) => L.latLng(v.latitude, v.longitude))),
      { padding: [24, 24], maxZoom: Math.min(16, this.provider.maxZoom), animate: false },
    );
  }
  focusVehicle(vehicleId: string): void {
    const entry = this.markers.get(vehicleId);
    if (entry) this.map.panTo(entry.marker.getLatLng(), { animate: false });
  }
  retryTiles(): void {
    this.layer.redraw();
  }
  destroy(): void {
    this.observer?.disconnect();
    this.map.remove();
    this.markers.clear();
  }
}

export const createLeafletFleetMap: FleetMapFactory = (host, provider, select, tiles) =>
  new LeafletFleetMap(host, provider, select, tiles);
