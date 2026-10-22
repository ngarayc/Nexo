import { vehicleState } from '../../telemetry/public.js';
import type { EventView, VehicleState } from '../../telemetry/public.js';

export interface VehicleView extends EventView {
  readonly status: VehicleState;
}
export interface AlertView extends Omit<EventView, 'ignitionOn'> {
  readonly type: 'OVERSPEED';
}
export interface FleetView {
  readonly items: readonly VehicleView[];
  readonly total: number;
  readonly overallTotal: number;
  readonly summary: Readonly<Record<VehicleState, number>>;
}
export interface AlertCollection {
  readonly items: readonly AlertView[];
  readonly total: number;
  readonly overallTotal: number;
}
export interface ReadModel {
  fleet(): Promise<readonly EventView[]>;
  history(vehicleId: string): Promise<readonly EventView[]>;
  alerts(): Promise<readonly AlertView[]>;
  snapshot(): Promise<{
    readonly vehicles: readonly EventView[];
    readonly alerts: readonly AlertView[];
  }>;
}

function fleetView(events: readonly EventView[], q: string): FleetView {
  const summary: Record<VehicleState, number> = { OFF: 0, MOVING: 0, STOPPED: 0 };
  const all = events.map((event) => {
    const status = vehicleState(event);
    summary[status]++;
    return { ...event, status };
  });
  const search = q.toLowerCase();
  const items = search ? all.filter((item) => item.vehicleId.toLowerCase().includes(search)) : all;
  return { items, total: items.length, overallTotal: all.length, summary };
}
const alertView = (items: readonly AlertView[]): AlertCollection => ({
  items,
  total: items.length,
  overallTotal: items.length,
});

export class DomainQueries {
  constructor(
    private readonly model: ReadModel,
    private readonly instanceId: string,
  ) {}
  async fleet(q = '') {
    return fleetView(await this.model.fleet(), q);
  }
  async history(vehicleId: string) {
    const items = await this.model.history(vehicleId);
    return { vehicleId, items, total: items.length };
  }
  async alerts() {
    return alertView(await this.model.alerts());
  }
  async snapshot() {
    const result = await this.model.snapshot();
    return {
      schemaVersion: 1 as const,
      instanceId: this.instanceId,
      vehicles: fleetView(result.vehicles, ''),
      alerts: alertView(result.alerts),
    };
  }
}

export class InvalidQuery extends Error {
  constructor() {
    super('INVALID_QUERY');
  }
}
export function readSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new InvalidQuery();
  return value;
}
export function readFleetQuery(query: Readonly<Record<string, unknown>>): string {
  if (Object.keys(query).some((name) => name !== 'q')) throw new InvalidQuery();
  return readSearch(query['q']);
}
export function readVehicleId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new InvalidQuery();
  return value;
}
export function readHistoryBody(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'vehicleId')
  )
    throw new InvalidQuery();
  return readVehicleId((value as Record<string, unknown>)['vehicleId']);
}
