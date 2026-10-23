import { InjectionToken } from '@angular/core';
import { createChartJsSpeed } from './chart-js-speed';
import type { SpeedChartFactory } from './speed-chart-renderer';

export const SPEED_CHART_FACTORY = new InjectionToken<SpeedChartFactory>('SpeedChartFactory', {
  providedIn: 'root',
  factory: () => createChartJsSpeed,
});
