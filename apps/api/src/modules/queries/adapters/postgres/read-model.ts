import type { Pool, PoolClient } from 'pg';
import { decodeIdentity, encodeIdentity, observedInstantUtc } from '../../../telemetry/public.js';
import type { EventView } from '../../../telemetry/public.js';
import type { AlertCollection, AlertView, ReadModel } from '../../application/queries.js';

type EventRow = {
  event_key: Buffer;
  vehicle_key: Buffer;
  observed_epoch_second: string;
  observed_fraction: string;
  observed_at_original: string;
  latitude: number;
  longitude: number;
  speed_kph: number;
  ignition_on: boolean;
};
type FilteredAlertRow = { overall_total: string } & {
  [Key in keyof EventRow]: EventRow[Key] | null;
};
const columns =
  'e.event_key,e.vehicle_key,e.observed_epoch_second::text,e.observed_fraction,e.observed_at_original,e.latitude,e.longitude,e.speed_kph,e.ignition_on';
const fleetSql = `SELECT ${columns} FROM vehicle_latest v JOIN telemetry_events e ON e.event_pk=v.event_pk ORDER BY v.vehicle_key`;
const alertsSql = `SELECT ${columns} FROM alerts a JOIN telemetry_events e ON e.event_pk=a.event_pk ORDER BY e.observed_epoch_second DESC,e.observed_fraction COLLATE "C" DESC,e.event_key DESC`;
const filteredAlertsSql = `SELECT ${columns},totals.overall_total
FROM (SELECT count(*)::text AS overall_total FROM alerts) totals
LEFT JOIN telemetry_events e ON e.vehicle_key=$1 AND EXISTS (
  SELECT 1 FROM alerts a WHERE a.event_pk=e.event_pk
)
ORDER BY e.observed_epoch_second DESC,e.observed_fraction COLLATE "C" DESC,e.event_key DESC`;
function eventView(row: EventRow): EventView {
  return {
    eventId: decodeIdentity(row.event_key),
    vehicleId: decodeIdentity(row.vehicle_key),
    observedAt: observedInstantUtc({
      epochSecond: BigInt(row.observed_epoch_second),
      fraction: row.observed_fraction,
    }),
    observedAtOriginal: row.observed_at_original,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKph: row.speed_kph,
    ignitionOn: row.ignition_on,
  };
}
function alertView(row: EventRow): AlertView {
  const event = eventView(row);
  return {
    type: 'OVERSPEED',
    eventId: event.eventId,
    vehicleId: event.vehicleId,
    observedAt: event.observedAt,
    observedAtOriginal: row.observed_at_original,
    speedKph: event.speedKph,
    latitude: event.latitude,
    longitude: event.longitude,
  };
}

// El controlador reserva el presupuesto compartido antes de parser/consulta.
export class PostgresReadModel implements ReadModel {
  constructor(private readonly pool: Pool) {}
  async fleet(): Promise<readonly EventView[]> {
    return (await this.pool.query<EventRow>(fleetSql)).rows.map(eventView);
  }
  async history(vehicleId: string): Promise<readonly EventView[]> {
    return (
      await this.pool.query<EventRow>(
        `SELECT ${columns} FROM telemetry_events e WHERE e.vehicle_key=$1 ORDER BY e.observed_epoch_second,e.observed_fraction COLLATE "C",e.event_key`,
        [Buffer.from(encodeIdentity(vehicleId))],
      )
    ).rows.map(eventView);
  }
  async alerts(vehicleId?: string): Promise<AlertCollection> {
    if (vehicleId === undefined) {
      const items = (await this.pool.query<EventRow>(alertsSql)).rows.map(alertView);
      return { items, total: items.length, overallTotal: items.length };
    }
    const { rows } = await this.pool.query<FilteredAlertRow>(filteredAlertsSql, [
      Buffer.from(encodeIdentity(vehicleId)),
    ]);
    // El agregado conserva una fila incluso cuando el LEFT JOIN no encuentra alertas.
    const overallTotal = Number(rows[0]?.overall_total);
    const items = rows
      .filter((row): row is FilteredAlertRow & EventRow => row.event_key !== null)
      .map(alertView);
    if (!Number.isSafeInteger(overallTotal) || overallTotal < items.length)
      throw new Error('Total de alertas no verificable.');
    return { items, total: items.length, overallTotal };
  }
  async snapshot() {
    const client: PoolClient = await this.pool.connect();
    let confirmed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL transaction_timeout='10s'");
      const vehicles = (await client.query<EventRow>(fleetSql)).rows.map(eventView);
      const alerts = (await client.query<EventRow>(alertsSql)).rows.map(alertView);
      await client.query('COMMIT');
      confirmed = true;
      return { vehicles, alerts };
    } finally {
      client.release(!confirmed);
    }
  }
}
