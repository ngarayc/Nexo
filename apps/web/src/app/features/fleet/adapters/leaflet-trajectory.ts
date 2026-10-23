import * as L from 'leaflet';
import type { EventView } from '@nexo/contracts';
import type { MapProvider } from '../../../platform/maps/map-provider-config';
import { LeafletMapSurface } from '../../../platform/maps/leaflet-map-surface';
import type { TilePhase } from '../../../platform/maps/leaflet-map-surface';
import { formatIdentity, identityPreview } from '../../../platform/presentation/identity-text';
import { formatTime } from '../../../platform/presentation/format-time';
import type { TrajectoryFactory, TrajectoryRenderer } from './trajectory-renderer';
import { addGeofenceLayer, fitGeofence } from './geofence-layer';

function label(event: EventView): string {
  return `${formatTime(event.observedAt)} · ${event.speedKph} km/h`;
}
function tooltip(event: EventView): HTMLElement {
  const node = document.createElement('div');
  const identity = document.createElement('strong');
  identity.textContent = 'Observación ' + identityPreview(event.eventId);
  const values = document.createElement('p');
  values.textContent = label(event);
  node.append(identity, values);
  return node;
}

class LeafletTrajectory implements TrajectoryRenderer {
  private readonly surface: LeafletMapSurface;
  private readonly markers = new Map<string, { marker: L.Marker; event: EventView }>();
  private line: L.Polyline | undefined;
  private vehicleId?: string;
  private fitted = false;
  private previousSelection: string | null = null;
  private events: readonly EventView[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly provider: MapProvider,
    private readonly select: (eventId: string) => void,
    tiles: (phase: TilePhase) => void,
  ) {
    this.surface = new LeafletMapSurface(host, provider, tiles);
    addGeofenceLayer(this.surface.map);
  }
  sync(vehicleId: string, events: readonly EventView[], selected: string | null): void {
    if (this.vehicleId !== vehicleId) {
      for (const { marker } of this.markers.values()) marker.remove();
      this.markers.clear();
      this.line?.remove();
      this.line = undefined;
      this.fitted = false;
      this.previousSelection = null;
      this.vehicleId = vehicleId;
    }
    this.events = events;
    if (!this.fitted && events.length) {
      this.fit();
      this.fitted = true;
    }
    const ids = new Set(events.map((event) => event.eventId));
    for (const [id, { marker }] of this.markers) {
      if (ids.has(id)) continue;
      const focused = marker.getElement()?.contains(document.activeElement);
      marker.remove();
      this.markers.delete(id);
      if (focused) this.host.focus();
    }
    for (const event of events) {
      let entry = this.markers.get(event.eventId);
      let marker = entry?.marker;
      if (!marker) {
        const symbol = document.createElement('span');
        symbol.textContent = '●';
        marker = L.marker([event.latitude, event.longitude], {
          keyboard: true,
          autoPanOnFocus: true,
          icon: L.divIcon({
            html: symbol,
            className: 'nexo-trajectory-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        }).addTo(this.surface.map);
        marker.bindTooltip(tooltip(event), {
          direction: 'top',
          className: 'nexo-trajectory-tooltip',
        });
        marker.on('click', () => this.select(event.eventId));
        marker.on('keydown', (keyboard: L.LeafletKeyboardEvent) => {
          if (!['Enter', ' '].includes(keyboard.originalEvent.key)) return;
          L.DomEvent.stop(keyboard.originalEvent);
          if (!keyboard.originalEvent.repeat) this.select(event.eventId);
        });
        entry = { marker, event };
        this.markers.set(event.eventId, entry);
      } else if (entry && entry.event !== event) {
        marker.setLatLng([event.latitude, event.longitude]);
        marker.setTooltipContent(tooltip(event));
        entry.event = event;
      }
      marker
        .getElement()
        ?.setAttribute(
          'aria-label',
          `Observación ${formatIdentity(event.eventId)} · ${label(event)}`,
        );
      marker.getElement()?.classList.toggle('is-selected', event.eventId === selected);
      marker.setZIndexOffset(event.eventId === selected ? 1000 : 0);
    }
    if (events.length >= 2) {
      const points = events.map((event) => L.latLng(event.latitude, event.longitude));
      if (this.line) this.line.setLatLngs(points);
      else
        this.line = L.polyline(points, {
          className: 'nexo-trajectory-line',
          color: '#13766d',
          weight: 3,
          smoothFactor: 0,
          interactive: false,
        }).addTo(this.surface.map);
    } else {
      this.line?.remove();
      this.line = undefined;
    }
    if (selected !== null && selected !== this.previousSelection) this.focusEvent(selected);
    this.previousSelection = selected;
  }
  fit(): void {
    if (!this.events.length) return;
    this.surface.map.invalidateSize({ pan: false });
    this.surface.map.fitBounds(
      L.latLngBounds(this.events.map((event) => L.latLng(event.latitude, event.longitude))),
      {
        padding: [24, 24],
        maxZoom: Math.min(16, this.provider.maxZoom),
        animate: false,
      },
    );
  }
  fitGeofence(): void {
    fitGeofence(this.surface.map);
  }
  focusEvent(eventId: string): void {
    const entry = this.markers.get(eventId);
    if (entry) this.surface.map.panTo(entry.marker.getLatLng(), { animate: false });
  }
  retryTiles(): void {
    this.surface.retryTiles();
  }
  destroy(): void {
    this.surface.destroy();
    this.markers.clear();
  }
}

export const createLeafletTrajectory: TrajectoryFactory = (host, provider, select, tiles) =>
  new LeafletTrajectory(host, provider, select, tiles);
