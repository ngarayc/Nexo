import { OriginalJson } from './original-json.js';
import { compareIdentity } from './identity.js';
import {
  readObservedInstant,
  compareObservedInstant,
  observedInstantUtc,
} from './observed-instant.js';
import type { ObservedInstant } from './observed-instant.js';

export type ValidationReason =
  | 'INVALID_EVENT'
  | 'INVALID_EVENT_ID'
  | 'INVALID_VEHICLE_ID'
  | 'INVALID_OBSERVED_AT'
  | 'INVALID_LATITUDE'
  | 'INVALID_LONGITUDE'
  | 'INVALID_SPEED'
  | 'INVALID_IGNITION';
export interface TelemetryEvent {
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: ObservedInstant;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly ignitionOn: boolean;
  readonly extra: OriginalJson;
}
export type EventValidation =
  | { readonly valid: true; readonly event: TelemetryEvent }
  | { readonly valid: false; readonly eventId: string | null; readonly reason: ValidationReason };
export type VehicleState = 'OFF' | 'MOVING' | 'STOPPED';
export interface EventView {
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly ignitionOn: boolean;
}
const knownFields = new Set([
  'eventId',
  'vehicleId',
  'observedAt',
  'latitude',
  'longitude',
  'speedKph',
  'ignitionOn',
]);

export function validateEvent(input: OriginalJson): EventValidation {
  const eventId = input.property('eventId')?.stringValue ?? null;
  const invalid = (reason: ValidationReason): EventValidation => ({
    valid: false,
    eventId,
    reason,
  });
  if (input.kind !== 'object') return invalid('INVALID_EVENT');
  if (eventId === null || eventId.length === 0) return invalid('INVALID_EVENT_ID');
  const vehicleId = input.property('vehicleId')?.stringValue;
  if (vehicleId === undefined || vehicleId.length === 0) return invalid('INVALID_VEHICLE_ID');
  const observedAt = readObservedInstant(input.property('observedAt')?.stringValue);
  if (!observedAt) return invalid('INVALID_OBSERVED_AT');
  const latitude = input.property('latitude')?.numberValue;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return invalid('INVALID_LATITUDE');
  const longitude = input.property('longitude')?.numberValue;
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    return invalid('INVALID_LONGITUDE');
  const speedKph = input.property('speedKph')?.numberValue;
  if (typeof speedKph !== 'number' || !Number.isFinite(speedKph) || speedKph < 0)
    return invalid('INVALID_SPEED');
  const ignitionOn = input.property('ignitionOn')?.booleanValue;
  if (typeof ignitionOn !== 'boolean') return invalid('INVALID_IGNITION');
  return {
    valid: true,
    event: Object.freeze({
      eventId,
      vehicleId,
      observedAt,
      latitude,
      longitude,
      speedKph,
      ignitionOn,
      extra: input.withoutProperties(knownFields),
    }),
  };
}

export function sameEventPayload(first: TelemetryEvent, second: TelemetryEvent): boolean {
  return (
    first.eventId === second.eventId &&
    first.vehicleId === second.vehicleId &&
    compareObservedInstant(first.observedAt, second.observedAt) === 0 &&
    first.latitude === second.latitude &&
    first.longitude === second.longitude &&
    first.speedKph === second.speedKph &&
    first.ignitionOn === second.ignitionOn &&
    first.extra.equals(second.extra)
  );
}
export function compareEventOrder(
  first: Pick<TelemetryEvent, 'eventId' | 'observedAt'>,
  second: Pick<TelemetryEvent, 'eventId' | 'observedAt'>,
): -1 | 0 | 1 {
  return (
    compareObservedInstant(first.observedAt, second.observedAt) ||
    compareIdentity(first.eventId, second.eventId)
  );
}
export function vehicleState(event: Pick<TelemetryEvent, 'ignitionOn' | 'speedKph'>): VehicleState {
  return !event.ignitionOn ? 'OFF' : event.speedKph > 0 ? 'MOVING' : 'STOPPED';
}
export function isOverspeed(event: Pick<TelemetryEvent, 'speedKph'>): boolean {
  return event.speedKph > 80;
}
export function eventView(event: TelemetryEvent): EventView {
  return {
    eventId: event.eventId,
    vehicleId: event.vehicleId,
    observedAt: observedInstantUtc(event.observedAt),
    latitude: event.latitude,
    longitude: event.longitude,
    speedKph: event.speedKph,
    ignitionOn: event.ignitionOn,
  };
}
