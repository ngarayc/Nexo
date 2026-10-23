import type { VehicleView } from '@nexo/contracts';
import type { MapProvider } from '../../../platform/maps/map-provider-config';
import type { TilePhase } from '../../../platform/maps/leaflet-map-surface';

export type { TilePhase } from '../../../platform/maps/leaflet-map-surface';
export interface FleetMapRenderer {
  sync(vehicles: readonly VehicleView[], selected: string | null): void;
  fit(): void;
  focusVehicle(vehicleId: string): void;
  retryTiles(): void;
  destroy(): void;
}
export type FleetMapFactory = (
  host: HTMLElement,
  provider: MapProvider,
  select: (id: string) => void,
  tiles: (phase: TilePhase) => void,
) => FleetMapRenderer;
