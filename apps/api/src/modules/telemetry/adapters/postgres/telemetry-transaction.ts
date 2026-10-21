import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { compareEventOrder } from '../../domain/event.js';
import type { TelemetryEvent } from '../../domain/event.js';
import { encodeIdentity, decodeIdentity } from '../../domain/identity.js';
import { OriginalJson } from '../../domain/original-json.js';
import { changeMessage, changeFrame } from '../../application/change-message.js';
import type { ChangeType } from '../../application/change-message.js';
import type { StoredTelemetry, TelemetryEffects } from '../../application/classify.js';

type EventRow = {
  event_pk: string;
  event_key: Buffer;
  vehicle_key: Buffer;
  observed_at_original: string;
  observed_epoch_second: string;
  observed_fraction: string;
  latitude: number;
  longitude: number;
  speed_kph: number;
  ignition_on: boolean;
  payload_extra: string;
};

const columns = sql`event_pk::text,event_key,vehicle_key,observed_at_original,
  observed_epoch_second::text,observed_fraction,latitude,longitude,speed_kph,
  ignition_on,payload_extra::text`;

function stored(row: EventRow): StoredTelemetry {
  return {
    eventPk: BigInt(row.event_pk),
    event: {
      eventId: decodeIdentity(row.event_key),
      vehicleId: decodeIdentity(row.vehicle_key),
      observedAt: {
        original: row.observed_at_original,
        epochSecond: BigInt(row.observed_epoch_second),
        fraction: row.observed_fraction,
      },
      latitude: row.latitude,
      longitude: row.longitude,
      speedKph: row.speed_kph,
      ignitionOn: row.ignition_on,
      extra: OriginalJson.parse(row.payload_extra),
    },
  };
}

export class TelemetryTransaction implements TelemetryEffects {
  constructor(private readonly tx: Pick<NodePgDatabase, 'execute'>) {}

  async insert(event: TelemetryEvent): Promise<StoredTelemetry | undefined> {
    const result = await this.tx.execute<{ event_pk: string }>(sql`
      INSERT INTO telemetry_events(event_key,vehicle_key,observed_at_original,
        observed_epoch_second,observed_fraction,latitude,longitude,speed_kph,ignition_on,payload_extra)
      VALUES (${Buffer.from(encodeIdentity(event.eventId))},${Buffer.from(encodeIdentity(event.vehicleId))},
        ${event.observedAt.original},${event.observedAt.epochSecond.toString()},${event.observedAt.fraction},
        ${event.latitude},${event.longitude},${event.speedKph},${event.ignitionOn},${event.extra.raw}::json)
      ON CONFLICT ON CONSTRAINT telemetry_events_event_key_unique DO NOTHING
      RETURNING event_pk::text`);
    const row = result.rows[0];
    return row ? { eventPk: BigInt(row.event_pk), event } : undefined;
  }

  async find(eventId: string): Promise<StoredTelemetry | undefined> {
    const result = await this.tx.execute<EventRow>(sql`
      SELECT ${columns} FROM telemetry_events WHERE event_key=${Buffer.from(encodeIdentity(eventId))}`);
    return result.rows[0] ? stored(result.rows[0]) : undefined;
  }

  async promoteLatest(candidate: StoredTelemetry): Promise<boolean> {
    const vehicleKey = Buffer.from(encodeIdentity(candidate.event.vehicleId));
    const inserted = await this.tx.execute<{ event_pk: string }>(sql`
      INSERT INTO vehicle_latest(vehicle_key,event_pk) VALUES (${vehicleKey},${candidate.eventPk.toString()})
      ON CONFLICT ON CONSTRAINT vehicle_latest_vehicle_key_unique DO NOTHING RETURNING event_pk::text`);
    if (inserted.rows.length > 0) return true;
    // El bloqueo y la lectura son sentencias distintas. La segunda observa al
    // ganador de una actualización concurrente tras esperar el bloqueo.
    const locked = await this.tx.execute(sql`
      SELECT event_pk FROM vehicle_latest WHERE vehicle_key=${vehicleKey} FOR UPDATE`);
    if (locked.rows.length !== 1) throw new Error('Proyección de vehículo ausente.');
    const current = await this.tx.execute<EventRow>(sql`
      SELECT ${columns} FROM telemetry_events WHERE event_pk=(
        SELECT event_pk FROM vehicle_latest WHERE vehicle_key=${vehicleKey})`);
    if (!current.rows[0]) throw new Error('Evento de proyección ausente.');
    if (compareEventOrder(candidate.event, stored(current.rows[0]).event) <= 0) return false;
    await this.tx.execute(sql`
      UPDATE vehicle_latest SET event_pk=${candidate.eventPk.toString()} WHERE vehicle_key=${vehicleKey}`);
    return true;
  }

  async createAlert(event: StoredTelemetry): Promise<void> {
    await this.tx.execute(
      sql`INSERT INTO alerts(event_pk,type) VALUES (${event.eventPk.toString()},'OVERSPEED')`,
    );
  }

  async append(type: ChangeType, event: StoredTelemetry): Promise<void> {
    const message = changeMessage(type, event.event, randomUUID());
    const payload = JSON.stringify(message);
    const bytes = Buffer.byteLength(changeFrame(message));
    await this.tx.execute(sql`
      INSERT INTO outbox_messages(message_id,event_pk,type,schema_version,payload,frame_bytes)
      VALUES (${message.messageId},${event.eventPk.toString()},${type},1,${payload}::json,${bytes})`);
  }
}
