import type { EventView } from '@nexo/contracts';
import type { MapProvider } from '../../../platform/maps/map-provider-config';
import type { TilePhase } from '../../../platform/maps/leaflet-map-surface';

export interface TrajectoryRenderer {
  sync(vehicleId: string, events: readonly EventView[], selected: string | null): void;
  fit(): void;
  focusEvent(eventId: string): void;
  retryTiles(): void;
  destroy(): void;
}
export type TrajectoryFactory = (
  host: HTMLElement,
  provider: MapProvider,
  select: (eventId: string) => void,
  tiles: (phase: TilePhase) => void,
) => TrajectoryRenderer;
