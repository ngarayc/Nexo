import type { EventView } from '@nexo/contracts';

export interface SpeedChartRenderer {
  sync(events: readonly EventView[], selected: string | null): void;
  destroy(): void;
}
export type SpeedChartFactory = (
  canvas: HTMLCanvasElement,
  select: (eventId: string) => void,
) => SpeedChartRenderer;
