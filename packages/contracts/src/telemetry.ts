export type VehicleState = 'OFF' | 'MOVING' | 'STOPPED';
export interface EventView {
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: string;
  // Metadato de salida. Opcional para leer notificaciones conservadas anteriores.
  readonly observedAtOriginal?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly ignitionOn: boolean;
}
export interface VehicleView extends EventView {
  readonly status: VehicleState;
}
export interface AlertView extends Omit<EventView, 'ignitionOn'> {
  readonly type: 'OVERSPEED';
}
export interface FleetCollection {
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
export interface DomainSnapshot {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly vehicles: FleetCollection;
  readonly alerts: AlertCollection;
}
export interface VehicleHistory {
  readonly vehicleId: string;
  readonly items: readonly EventView[];
  readonly total: number;
}
interface ChangeEnvelope {
  readonly messageId: string;
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: string;
}
export type DomainChange = ChangeEnvelope &
  (
    | { readonly type: 'telemetry.accepted'; readonly data: EventView }
    | {
        readonly type: 'vehicle.updated';
        readonly data: EventView & { readonly state: VehicleState };
      }
    | { readonly type: 'alert.created'; readonly data: EventView & { readonly type: 'OVERSPEED' } }
  );
export type StreamControl = { readonly schemaVersion: 1; readonly instanceId: string } & (
  | { readonly type: 'stream.ready'; readonly heartbeatMilliseconds: 15000 }
  | { readonly type: 'stream.heartbeat' }
  | { readonly type: 'stream.resync-required'; readonly reason: 'CLIENT_CAPACITY' }
);
