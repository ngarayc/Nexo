import type { EventView } from '@nexo/contracts';
import { compareViews } from '../../platform/telemetry/order';

export const demoGeofence = Object.freeze({
  name: 'Zona de demostración',
  south: 14.605,
  west: -90.545,
  north: 14.621,
  east: -90.529,
});
export type GeofenceStatus = 'inside' | 'outside' | 'unknown';
export const geofenceLabels: Readonly<Record<GeofenceStatus, string>> = Object.freeze({
  inside: 'Dentro',
  outside: 'Fuera',
  unknown: 'Sin posición válida',
});

export function geofenceStatus(
  position: Pick<EventView, 'latitude' | 'longitude'>,
): GeofenceStatus {
  const { latitude, longitude } = position;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return 'unknown';
  return latitude >= demoGeofence.south &&
    latitude <= demoGeofence.north &&
    longitude >= demoGeofence.west &&
    longitude <= demoGeofence.east
    ? 'inside'
    : 'outside';
}

export interface GeofenceChange {
  readonly before: EventView;
  readonly after: EventView;
  readonly kind: 'entry' | 'exit';
}

// Lectura derivada: nunca interpola una posición o fecha exacta de cruce.
export function geofenceChanges(events: readonly EventView[]): readonly GeofenceChange[] {
  const previous = new Map<string, { event: EventView; status: GeofenceStatus }>();
  const seen = new Set<string>();
  const changes: GeofenceChange[] = [];
  for (const event of [...events].sort(compareViews)) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const status = geofenceStatus(event);
    if (status === 'unknown') {
      previous.delete(event.vehicleId);
      continue;
    }
    const last = previous.get(event.vehicleId);
    if (last && last.status !== status)
      changes.push(
        Object.freeze({
          before: last.event,
          after: event,
          kind: status === 'inside' ? 'entry' : 'exit',
        }),
      );
    previous.set(event.vehicleId, { event, status });
  }
  return Object.freeze(changes);
}
