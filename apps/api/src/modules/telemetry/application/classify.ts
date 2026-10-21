import { sameEventPayload, validateEvent, isOverspeed } from '../domain/event.js';
import type { TelemetryEvent, ValidationReason } from '../domain/event.js';
import type { OriginalJson } from '../domain/original-json.js';
import type { ChangeType } from './change-message.js';

export interface StoredTelemetry {
  readonly eventPk: bigint;
  readonly event: TelemetryEvent;
}
export class TelemetryInvariantError extends Error {}
// Todos los puertos deben pertenecer a la misma transacción de la posición.
export interface TelemetryEffects {
  insert(event: TelemetryEvent): Promise<StoredTelemetry | undefined>;
  find(eventId: string): Promise<StoredTelemetry | undefined>;
  promoteLatest(stored: StoredTelemetry): Promise<boolean>;
  createAlert(stored: StoredTelemetry): Promise<void>;
  append(type: ChangeType, stored: StoredTelemetry): Promise<void>;
}
export type Classification =
  | { readonly outcome: 'accepted' | 'duplicate'; readonly eventPk: bigint }
  | {
      readonly outcome: 'rejected';
      readonly reason: ValidationReason | 'EVENT_ID_CONFLICT';
    };

export class ClassifyTelemetry {
  async execute(input: OriginalJson, effects: TelemetryEffects): Promise<Classification> {
    const validation = validateEvent(input);
    if (!validation.valid) return { outcome: 'rejected', reason: validation.reason };
    const event = validation.event;
    const created = await effects.insert(event);
    if (!created) {
      // Nueva sentencia tras el conflicto: no reutilizar un snapshot previo al INSERT.
      const previous = await effects.find(event.eventId);
      if (!previous)
        throw new TelemetryInvariantError('No se pudo leer el evento que resolvió el conflicto.');
      return sameEventPayload(previous.event, event)
        ? { outcome: 'duplicate', eventPk: previous.eventPk }
        : { outcome: 'rejected', reason: 'EVENT_ID_CONFLICT' };
    }
    const changed = await effects.promoteLatest(created);
    const overspeed = isOverspeed(event);
    if (overspeed) await effects.createAlert(created);
    await effects.append('telemetry.accepted', created);
    if (changed) await effects.append('vehicle.updated', created);
    if (overspeed) await effects.append('alert.created', created);
    return { outcome: 'accepted', eventPk: created.eventPk };
  }
}
