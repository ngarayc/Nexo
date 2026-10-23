import { InjectionToken } from '@angular/core';
import type { FleetMapFactory } from './fleet-map-renderer';
import { createLeafletFleetMap } from './leaflet-fleet-map';

export const FLEET_MAP_FACTORY = new InjectionToken<FleetMapFactory>('fleet-map-factory', {
  providedIn: 'root',
  factory: () => createLeafletFleetMap,
});
