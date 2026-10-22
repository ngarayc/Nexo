import type { VehicleView } from '@nexo/contracts';
import type { MapProvider } from '../../../platform/maps/map-provider-config';

export type TilePhase = 'loading' | 'ready' | 'error';
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
