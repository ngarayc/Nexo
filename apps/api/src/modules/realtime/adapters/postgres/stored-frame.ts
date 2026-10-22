import {
  OriginalJson,
  validateEvent,
  eventView,
  vehicleState,
  isOverspeed,
  changeFrame,
} from '../../../telemetry/public.js';
import type { ChangeMessage } from '../../../telemetry/public.js';
import type { PendingMessage } from '../../application/dispatch.js';

const envelopeKeys = [
  'messageId',
  'schemaVersion',
  'type',
  'eventId',
  'vehicleId',
  'observedAt',
  'data',
];
const eventKeys = [
  'eventId',
  'vehicleId',
  'observedAt',
  'latitude',
  'longitude',
  'speedKph',
  'ignitionOn',
];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));

export function storedFrame(metadata: PendingMessage, payload: string): string {
  const invalid = () => new Error('OUTBOX_PAYLOAD_INVALID');
  const message: unknown = JSON.parse(payload);
  if (
    !object(message) ||
    !keys(message, envelopeKeys) ||
    message['messageId'] !== metadata.messageId ||
    message['schemaVersion'] !== 1 ||
    metadata.schemaVersion !== 1 ||
    message['type'] !== metadata.type ||
    !object(message['data'])
  )
    throw invalid();
  const data = message['data'];
  const extra =
    metadata.type === 'vehicle.updated'
      ? ['state']
      : metadata.type === 'alert.created'
        ? ['type']
        : [];
  if (!keys(data, [...eventKeys, ...extra])) throw invalid();
  const validated = validateEvent(OriginalJson.parse(JSON.stringify(data)));
  if (!validated.valid) throw invalid();
  const event = eventView(validated.event);
  if (
    message['eventId'] !== event.eventId ||
    message['vehicleId'] !== event.vehicleId ||
    message['observedAt'] !== event.observedAt ||
    data['observedAt'] !== event.observedAt ||
    (metadata.type === 'vehicle.updated' && data['state'] !== vehicleState(event)) ||
    (metadata.type === 'alert.created' && (data['type'] !== 'OVERSPEED' || !isOverspeed(event)))
  )
    throw invalid();
  const frame = changeFrame(message as unknown as ChangeMessage);
  if (Buffer.byteLength(frame) !== metadata.frameBytes) throw invalid();
  return frame;
}
