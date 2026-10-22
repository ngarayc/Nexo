import { describe, expect, it } from 'vitest';
import { FileOfficialSources } from '../adapters/files/official-sources.js';
import {
  LoadOfficialFixture,
  OfficialSourcesUnavailable,
  officialHashes,
} from './official-fixture.js';
import type { OfficialSourceName } from './official-fixture.js';

describe('fuentes oficiales originales, sin usar el clasificador como oráculo', () => {
  const files = new FileOfficialSources();
  it('conserva24líneas, cuerpo literal y expectativas20/2/2→0/22/2', async () => {
    const fixture = await new LoadOfficialFixture(files).load();
    expect(fixture.rows).toHaveLength(24);
    const original = Buffer.from(await files.read('events.jsonl'))
      .toString('utf8')
      .trimEnd()
      .split('\n');
    expect(fixture.rows.map((row) => row.body)).toEqual(
      original.map((line) => '{"events":[' + line + ']}'),
    );
    expect(fixture.rows.filter((row) => row.firstOutcome === 'accepted')).toHaveLength(20);
    expect(fixture.rows.filter((row) => row.firstOutcome === 'duplicate')).toHaveLength(2);
    expect(fixture.rows.filter((row) => row.firstOutcome === 'rejected')).toHaveLength(2);
    expect(fixture.rows.filter((row) => row.secondOutcome === 'duplicate')).toHaveLength(22);
    expect(Object.keys(fixture.acceptedEvents)).toHaveLength(20);
    expect(fixture.sample.status_by_vehicle['VEH-007']).toBe('STOPPED');
    expect(Object.isFrozen(fixture.rows[0]?.fields)).toBe(true);
    expect(Object.isFrozen(fixture.detailed.history_by_vehicle_ascending['VEH-001'])).toBe(true);
  });
  it('conserva las líneas inválidas y distingue su número original del índice0', async () => {
    const fixture = await new LoadOfficialFixture(files).load();
    expect(fixture.rows[21]).toMatchObject({
      lineNumber: 22,
      batchIndex: 0,
      eventId: 'E-006-03',
      firstOutcome: 'rejected',
      reason: 'INVALID_LATITUDE',
    });
    expect(fixture.rows[22]).toMatchObject({
      lineNumber: 23,
      batchIndex: 0,
      eventId: 'E-007-03',
      firstOutcome: 'rejected',
      reason: 'INVALID_SPEED',
    });
    expect(JSON.parse(fixture.rows[22]!.body).events[0].speedKph).toBe(
      fixture.rows[22]!.fields['speedKph'],
    );
  });
  it.each(Object.keys(officialHashes) as OfficialSourceName[])(
    'no acepta la fuente alterada%s',
    async (changed) => {
      const sources = {
        read: async (name: OfficialSourceName) => {
          const bytes = await files.read(name);
          return name === changed ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
        },
      };
      await expect(new LoadOfficialFixture(sources).load()).rejects.toBeInstanceOf(
        OfficialSourcesUnavailable,
      );
    },
  );
  it('una lectura fallida no devuelve ceros o fuentes parciales', async () => {
    const sources = {
      read: async () => {
        throw new Error('synthetic-private-marker');
      },
    };
    try {
      await new LoadOfficialFixture(sources).load();
      throw new Error('Debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(OfficialSourcesUnavailable);
      expect(String(error)).not.toContain('synthetic-private-marker');
    }
  });
  it('el adaptador rechaza rutas que no son los tres nombres fijos', async () => {
    await expect(files.read('../../../.env.local' as OfficialSourceName)).rejects.toBeInstanceOf(
      OfficialSourcesUnavailable,
    );
  });
});
