import { createHash } from 'node:crypto';

// Integridad de las fuentes suministradas, independiente del clasificador.
export const officialHashes = Object.freeze({
  'events.jsonl': '102656a5bafa06f5172a1f5e4a50c770b547113f7f0fe13d8fa0722fcdce65be',
  'expected_sample.json': '31291e747309f8a13eeb19efc5a7a61f50e7bdd5ffed30dfdd5a157dac9ff333',
  'expected_detailed.json': '3591f85b0291844e788b3f1b3b899758b3e6ffdeda9517ddff448368ffcbb066',
});
export type OfficialSourceName = keyof typeof officialHashes;
export interface OfficialSources {
  read(name: OfficialSourceName): Promise<Uint8Array>;
}
export class OfficialSourcesUnavailable extends Error {
  constructor() {
    super('No se pudo comprobar la integridad de las fuentes oficiales.');
  }
}
interface CounterSet {
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly vehicles: number;
  readonly alerts: number;
}
interface DetailedOracle {
  readonly first_run: CounterSet & { readonly input: number };
  readonly accepted_event_ids: readonly string[];
  readonly duplicates_at_input_indexes_zero_based: readonly { index: number; eventId: string }[];
  readonly rejections_at_input_indexes_zero_based: readonly {
    index: number;
    eventId: string;
    reason: string;
  }[];
  readonly overspeed_event_ids: readonly string[];
  readonly latest_by_vehicle: Readonly<Record<string, string>>;
  readonly history_by_vehicle_ascending: Readonly<Record<string, readonly string[]>>;
  readonly second_run_without_reset: CounterSet & { readonly persisted_events: number };
}
interface SampleOracle {
  readonly input: number;
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly vehicles: number;
  readonly overspeed_alerts: number;
  readonly latest_by_vehicle: Readonly<Record<string, string>>;
  readonly status_by_vehicle: Readonly<Record<string, 'MOVING' | 'STOPPED' | 'OFF'>>;
}
export interface OfficialRow {
  readonly lineNumber: number;
  readonly batchIndex: 0;
  readonly eventId: string;
  readonly vehicleId: string;
  readonly body: string;
  readonly inputDocument: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly firstOutcome: 'accepted' | 'duplicate' | 'rejected';
  readonly secondOutcome: 'duplicate' | 'rejected';
  readonly reason: string | null;
}
export interface OfficialFixture {
  readonly fixtureSha256: string;
  readonly hashes: typeof officialHashes;
  readonly rows: readonly OfficialRow[];
  readonly detailed: DetailedOracle;
  readonly sample: SampleOracle;
  readonly acceptedEvents: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function requireSource(condition: boolean): asserts condition {
  if (!condition) throw new OfficialSourcesUnavailable();
}

export class LoadOfficialFixture {
  constructor(private readonly sources: OfficialSources) {}

  async load(): Promise<OfficialFixture> {
    try {
      const names = Object.keys(officialHashes) as OfficialSourceName[];
      const files = await Promise.all(
        names.map(async (name) => {
          const bytes = await this.sources.read(name);
          requireSource(createHash('sha256').update(bytes).digest('hex') === officialHashes[name]);
          return [name, Buffer.from(bytes).toString('utf8')] as const;
        }),
      );
      const text = Object.fromEntries(files) as Record<OfficialSourceName, string>;
      const detailed = JSON.parse(text['expected_detailed.json']) as DetailedOracle;
      const sample = JSON.parse(text['expected_sample.json']) as SampleOracle;
      // Split solo retira separadores; nunca parsea/stringify el cuerpo a enviar.
      const lines = text['events.jsonl'].split('\n');
      if (lines.at(-1) === '') lines.pop();
      requireSource(
        lines.length === 24 &&
          detailed.first_run.input === lines.length &&
          sample.input === lines.length,
      );
      const duplicates = new Map(
        detailed.duplicates_at_input_indexes_zero_based.map((item) => [item.index, item]),
      );
      const rejections = new Map(
        detailed.rejections_at_input_indexes_zero_based.map((item) => [item.index, item]),
      );
      const rows: readonly OfficialRow[] = lines.map((line, index) => {
        const fields = JSON.parse(line) as Record<string, unknown>;
        requireSource(
          typeof fields['eventId'] === 'string' && typeof fields['vehicleId'] === 'string',
        );
        const duplicate = duplicates.get(index),
          rejection = rejections.get(index);
        requireSource(!(duplicate && rejection));
        requireSource(!duplicate || duplicate.eventId === fields['eventId']);
        requireSource(!rejection || rejection.eventId === fields['eventId']);
        return {
          lineNumber: index + 1,
          batchIndex: 0,
          eventId: fields['eventId'],
          vehicleId: fields['vehicleId'],
          body: '{"events":[' + line + ']}',
          inputDocument: line.trim(),
          fields,
          firstOutcome: rejection ? 'rejected' : duplicate ? 'duplicate' : 'accepted',
          secondOutcome: rejection ? 'rejected' : 'duplicate',
          reason: rejection?.reason ?? null,
        };
      });
      const accepted = rows.filter((row) => row.firstOutcome === 'accepted');
      requireSource(
        accepted.length === detailed.first_run.accepted &&
          new Set(accepted.map((row) => row.eventId)).size === accepted.length,
      );
      requireSource(
        accepted.every((row) => detailed.accepted_event_ids.includes(row.eventId)) &&
          accepted.length === detailed.accepted_event_ids.length,
      );
      requireSource(
        duplicates.size === detailed.first_run.duplicates &&
          rejections.size === detailed.first_run.rejected,
      );
      requireSource(
        sample.accepted === detailed.first_run.accepted &&
          sample.duplicates === detailed.first_run.duplicates &&
          sample.rejected === detailed.first_run.rejected,
      );
      requireSource(
        sample.vehicles === detailed.first_run.vehicles &&
          sample.overspeed_alerts === detailed.overspeed_event_ids.length &&
          detailed.first_run.alerts === detailed.overspeed_event_ids.length,
      );
      requireSource(
        Object.keys(sample.latest_by_vehicle).length ===
          Object.keys(detailed.latest_by_vehicle).length &&
          Object.entries(sample.latest_by_vehicle).every(
            ([vehicleId, eventId]) => detailed.latest_by_vehicle[vehicleId] === eventId,
          ),
      );
      const histories = Object.values(detailed.history_by_vehicle_ascending).flat();
      requireSource(
        histories.length === accepted.length &&
          new Set(histories).size === accepted.length &&
          histories.every((id) => detailed.accepted_event_ids.includes(id)),
      );
      return freeze({
        fixtureSha256: officialHashes['events.jsonl'],
        hashes: officialHashes,
        rows,
        detailed,
        sample,
        acceptedEvents: Object.fromEntries(accepted.map((row) => [row.eventId, row.fields])),
      });
    } catch {
      // Una fuente ausente/alterada/ilegible nunca es una colección vacía.
      throw new OfficialSourcesUnavailable();
    }
  }
}
