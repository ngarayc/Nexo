import { readObservedInstant, compareObservedInstant } from './observed-instant.js';
import type { ObservedInstant } from './observed-instant.js';
import { compareIdentity } from './identity.js';
import type { EventView, VehicleState } from './telemetry.js';

export type FieldValidationReason =
  | 'INVALID_EVENT_ID'
  | 'INVALID_VEHICLE_ID'
  | 'INVALID_OBSERVED_AT'
  | 'INVALID_LATITUDE'
  | 'INVALID_LONGITUDE'
  | 'INVALID_SPEED'
  | 'INVALID_IGNITION';
export interface ObservationFields {
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: ObservedInstant;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
}
export interface EventFields extends ObservationFields {
  readonly ignitionOn: boolean;
}
type InvalidFields = {
  readonly valid: false;
  readonly eventId: string | null;
  readonly reason: FieldValidationReason;
};
type ValidFields<T> = { readonly valid: true; readonly fields: T };

// La alerta pública no transporta ignitionOn. Validar sus seis campos comunes
// no requiere inventar ese dato; el evento añade la comprobación del booleano.
export function validateObservationFields(
  input: Readonly<Record<string, unknown>>,
): ValidFields<ObservationFields> | InvalidFields {
  const eventId = typeof input['eventId'] === 'string' ? input['eventId'] : null;
  const invalid = (reason: FieldValidationReason): InvalidFields => ({
    valid: false,
    eventId,
    reason,
  });
  if (eventId === null || eventId.length === 0) return invalid('INVALID_EVENT_ID');
  const vehicleId = input['vehicleId'];
  if (typeof vehicleId !== 'string' || vehicleId.length === 0) return invalid('INVALID_VEHICLE_ID');
  const observedAt = readObservedInstant(input['observedAt']);
  if (!observedAt) return invalid('INVALID_OBSERVED_AT');
  const latitude = input['latitude'];
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return invalid('INVALID_LATITUDE');
  const longitude = input['longitude'];
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    return invalid('INVALID_LONGITUDE');
  const speedKph = input['speedKph'];
  if (typeof speedKph !== 'number' || !Number.isFinite(speedKph) || speedKph < 0)
    return invalid('INVALID_SPEED');
  return { valid: true, fields: { eventId, vehicleId, observedAt, latitude, longitude, speedKph } };
}
export function validateEventFields(
  input: Readonly<Record<string, unknown>>,
): ValidFields<EventFields> | InvalidFields {
  const base = validateObservationFields(input);
  if (!base.valid) return base;
  const ignitionOn = input['ignitionOn'];
  if (typeof ignitionOn !== 'boolean')
    return { valid: false, eventId: base.fields.eventId, reason: 'INVALID_IGNITION' };
  return { valid: true, fields: { ...base.fields, ignitionOn } };
}
export function vehicleState(event: Pick<EventView, 'ignitionOn' | 'speedKph'>): VehicleState {
  return !event.ignitionOn ? 'OFF' : event.speedKph > 0 ? 'MOVING' : 'STOPPED';
}
export function isOverspeed(event: Pick<EventView, 'speedKph'>): boolean {
  return event.speedKph > 80;
}
export interface ObservationOrder {
  readonly eventId: string;
  readonly observedAt: Pick<ObservedInstant, 'epochSecond' | 'fraction'>;
}
export function compareEventOrder(first: ObservationOrder, second: ObservationOrder): -1 | 0 | 1 {
  return (
    compareObservedInstant(first.observedAt, second.observedAt) ||
    compareIdentity(first.eventId, second.eventId)
  );
}
