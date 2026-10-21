import { eventView, vehicleState } from '../domain/event.js';
import type { EventView, TelemetryEvent, VehicleState } from '../domain/event.js';

export type ChangeType = 'telemetry.accepted' | 'vehicle.updated' | 'alert.created';
export interface VehicleView extends EventView {
  readonly state: VehicleState;
}
export interface AlertView extends EventView {
  readonly type: 'OVERSPEED';
}
export interface ChangeMessage {
  readonly messageId: string;
  readonly schemaVersion: 1;
  readonly type: ChangeType;
  readonly eventId: string;
  readonly vehicleId: string;
  readonly observedAt: string;
  readonly data: EventView | VehicleView | AlertView;
}

function requireFrameIdentity(messageId: string, type: ChangeType, schemaVersion: number): void {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(messageId) ||
    !['telemetry.accepted', 'vehicle.updated', 'alert.created'].includes(type) ||
    schemaVersion !== 1
  )
    throw new Error('Identidad o versión técnica del mensaje inválida.');
}

export function changeMessage(
  type: ChangeType,
  event: TelemetryEvent,
  messageId: string,
): ChangeMessage {
  requireFrameIdentity(messageId, type, 1);
  const view = eventView(event);
  const data = Object.freeze(
    type === 'vehicle.updated'
      ? { ...view, state: vehicleState(event) }
      : type === 'alert.created'
        ? { ...view, type: 'OVERSPEED' as const }
        : view,
  );
  return Object.freeze({
    messageId,
    schemaVersion: 1,
    type,
    eventId: view.eventId,
    vehicleId: view.vehicleId,
    observedAt: view.observedAt,
    data,
  });
}

// El dispatcher reutiliza esta trama: el ID libre de telemetría solo viaja en JSON.
export function changeFrame(message: ChangeMessage): string {
  requireFrameIdentity(message.messageId, message.type, message.schemaVersion);
  return `id:${message.messageId}\nevent:${message.type}\ndata:${JSON.stringify(message)}\n\n`;
}
