import {
  validateEventFields,
  validateObservationFields,
  observedInstantUtc,
  vehicleState,
  isOverspeed,
} from '@nexo/contracts';
import type {
  EventView,
  VehicleView,
  AlertView,
  DomainSnapshot,
  DomainChange,
  VehicleHistory,
  StreamControl,
} from '@nexo/contracts';

export class TelemetryProtocolError extends Error {
  constructor() {
    super('La información recibida no coincide con el protocolo.');
  }
}
export class CaptureCapacityError extends Error {
  constructor() {
    super('La actualización recibida supera el presupuesto de sincronización.');
  }
}
export const captureLimits = Object.freeze({ messages: 1000, bytes: 2 * 1024 * 1024 });
const eventKeys = [
  'eventId',
  'vehicleId',
  'observedAt',
  'latitude',
  'longitude',
  'speedKph',
  'ignitionOn',
];
const observationKeys = eventKeys.filter((name) => name !== 'ignitionOn');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const messageId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const invalid = (): never => {
  throw new TelemetryProtocolError();
};
function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return invalid();
  }
}
function record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  return input as Record<string, unknown>;
}
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = record(input);
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length) return invalid();
  return value;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return invalid();
  return value;
}
function count(value: unknown, expected: number): void {
  if (!Number.isSafeInteger(value) || value !== expected) invalid();
}
function unique<T>(items: readonly T[], key: (item: T) => string): void {
  if (new Set(items.map(key)).size !== items.length) invalid();
}

export function readEvent(input: unknown, extra: readonly string[] = []): EventView {
  const value = exact(input, [...eventKeys, ...extra]);
  const validated = validateEventFields(value);
  if (!validated.valid) return invalid();
  const fields = validated.fields;
  const observedAt = observedInstantUtc(fields.observedAt);
  if (value['observedAt'] !== observedAt) return invalid();
  return Object.freeze({ ...fields, observedAt });
}
function readVehicle(input: unknown): VehicleView {
  const view = readEvent(input, ['status']);
  const status = vehicleState(view);
  if (record(input)['status'] !== status) return invalid();
  return Object.freeze({ ...view, status });
}
function readAlert(input: unknown): AlertView {
  const value = exact(input, [...observationKeys, 'type']);
  const validated = validateObservationFields(value);
  if (!validated.valid || value['type'] !== 'OVERSPEED' || !isOverspeed(validated.fields))
    return invalid();
  const observedAt = observedInstantUtc(validated.fields.observedAt);
  if (value['observedAt'] !== observedAt) return invalid();
  return Object.freeze({ ...validated.fields, observedAt, type: 'OVERSPEED' });
}
export function readSnapshot(input: unknown): DomainSnapshot {
  const value = exact(input, ['schemaVersion', 'instanceId', 'vehicles', 'alerts']);
  const instanceId = text(value['instanceId']);
  if (value['schemaVersion'] !== 1 || !uuid.test(instanceId)) return invalid();
  const fleet = exact(value['vehicles'], ['items', 'total', 'overallTotal', 'summary']);
  const vehicles = array(fleet['items']).map(readVehicle);
  unique(vehicles, (item) => item.vehicleId);
  unique(vehicles, (item) => item.eventId);
  count(fleet['total'], vehicles.length);
  count(fleet['overallTotal'], vehicles.length);
  const summary = exact(fleet['summary'], ['OFF', 'MOVING', 'STOPPED']);
  const totals = { OFF: 0, MOVING: 0, STOPPED: 0 };
  for (const vehicle of vehicles) totals[vehicle.status]++;
  for (const status of ['OFF', 'MOVING', 'STOPPED'] as const)
    count(summary[status], totals[status]);
  const collection = exact(value['alerts'], ['items', 'total', 'overallTotal']);
  const alerts = array(collection['items']).map(readAlert);
  unique(alerts, (item) => item.eventId);
  count(collection['total'], alerts.length);
  count(collection['overallTotal'], alerts.length);
  const known = new Set(vehicles.map((item) => item.vehicleId));
  if (alerts.some((alert) => !known.has(alert.vehicleId))) return invalid();
  return Object.freeze({
    schemaVersion: 1,
    instanceId,
    vehicles: Object.freeze({
      items: Object.freeze(vehicles),
      total: vehicles.length,
      overallTotal: vehicles.length,
      summary: Object.freeze(totals),
    }),
    alerts: Object.freeze({
      items: Object.freeze(alerts),
      total: alerts.length,
      overallTotal: alerts.length,
    }),
  });
}
export function readHistory(input: unknown, vehicleId: string): VehicleHistory {
  const value = exact(input, ['vehicleId', 'items', 'total']);
  if (value['vehicleId'] !== vehicleId) return invalid();
  const items = array(value['items']).map((item) => readEvent(item));
  unique(items, (item) => item.eventId);
  count(value['total'], items.length);
  if (items.some((item) => item.vehicleId !== vehicleId)) return invalid();
  return Object.freeze({ vehicleId, items: Object.freeze(items), total: items.length });
}

export interface DomainFrame {
  readonly change: DomainChange;
  readonly bytes: number;
}
export function readDomainFrame(type: string, id: string, raw: string): DomainFrame {
  if (
    !['telemetry.accepted', 'vehicle.updated', 'alert.created'].includes(type) ||
    !messageId.test(id)
  )
    return invalid();
  const bytes = new TextEncoder().encode(`id:${id}\nevent:${type}\ndata:${raw}\n\n`).byteLength;
  if (bytes > captureLimits.bytes) throw new CaptureCapacityError();
  const value = exact(json(raw), [
    'messageId',
    'schemaVersion',
    'type',
    'eventId',
    'vehicleId',
    'observedAt',
    'data',
  ]);
  if (value['schemaVersion'] !== 1 || value['type'] !== type || value['messageId'] !== id)
    return invalid();
  const extra = type === 'vehicle.updated' ? ['state'] : type === 'alert.created' ? ['type'] : [];
  const data = readEvent(value['data'], extra);
  if (
    value['eventId'] !== data.eventId ||
    value['vehicleId'] !== data.vehicleId ||
    value['observedAt'] !== data.observedAt
  )
    return invalid();
  const extraData = record(value['data']);
  if (type === 'vehicle.updated' && extraData['state'] !== vehicleState(data)) return invalid();
  if (type === 'alert.created' && (extraData['type'] !== 'OVERSPEED' || !isOverspeed(data)))
    return invalid();
  // La frontera valida todas las propiedades antes de dar el tipo al modelo.
  Object.freeze(value['data']);
  Object.freeze(value);
  return Object.freeze({ change: value as unknown as DomainChange, bytes });
}
export function readStreamControl(type: string, raw: string): StreamControl {
  const extra =
    type === 'stream.ready'
      ? ['heartbeatMilliseconds']
      : type === 'stream.resync-required'
        ? ['reason']
        : [];
  if (!['stream.ready', 'stream.heartbeat', 'stream.resync-required'].includes(type))
    return invalid();
  const value = exact(json(raw), ['type', 'schemaVersion', 'instanceId', ...extra]);
  if (
    value['type'] !== type ||
    value['schemaVersion'] !== 1 ||
    !uuid.test(text(value['instanceId'])) ||
    (type === 'stream.ready' && value['heartbeatMilliseconds'] !== 15000) ||
    (type === 'stream.resync-required' && value['reason'] !== 'CLIENT_CAPACITY')
  )
    return invalid();
  return Object.freeze(value) as unknown as StreamControl;
}
