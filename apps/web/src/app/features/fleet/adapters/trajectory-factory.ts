import { InjectionToken } from '@angular/core';
import { createLeafletTrajectory } from './leaflet-trajectory';
import type { TrajectoryFactory } from './trajectory-renderer';

export const TRAJECTORY_FACTORY = new InjectionToken<TrajectoryFactory>('TrajectoryFactory', {
  providedIn: 'root',
  factory: () => createLeafletTrajectory,
});
