import { validateEventFields } from '@nexo/contracts';
import type { EventFields, EventView, FieldValidationReason } from '@nexo/contracts';
import { OriginalJson } from './original-json.js';
import { compareObservedInstant, observedInstantUtc } from './observed-instant.js';

export { vehicleState, isOverspeed, compareEventOrder } from '@nexo/contracts';
export type { EventView, VehicleState } from '@nexo/contracts';

export type ValidationReason = FieldValidationReason | 'INVALID_EVENT';
export interface TelemetryEvent extends EventFields {
  readonly extra: OriginalJson;
}
export type EventValidation =
  | { readonly valid: true; readonly event: TelemetryEvent }
  | { readonly valid: false; readonly eventId: string | null; readonly reason: ValidationReason };
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
  if (input.kind !== 'object') return { valid: false, eventId: null, reason: 'INVALID_EVENT' };
  const validated = validateEventFields({
    eventId: input.property('eventId')?.stringValue,
    vehicleId: input.property('vehicleId')?.stringValue,
    observedAt: input.property('observedAt')?.stringValue,
    latitude: input.property('latitude')?.numberValue,
    longitude: input.property('longitude')?.numberValue,
    speedKph: input.property('speedKph')?.numberValue,
    ignitionOn: input.property('ignitionOn')?.booleanValue,
  });
  if (!validated.valid) return validated;
  return {
    valid: true,
    event: Object.freeze({ ...validated.fields, extra: input.withoutProperties(knownFields) }),
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
export function eventView(event: TelemetryEvent): EventView {
  return {
    eventId: event.eventId,
    vehicleId: event.vehicleId,
    observedAt: observedInstantUtc(event.observedAt),
    observedAtOriginal: event.observedAt.original,
    latitude: event.latitude,
    longitude: event.longitude,
    speedKph: event.speedKph,
    ignitionOn: event.ignitionOn,
  };
}
