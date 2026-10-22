import { readFile } from 'node:fs/promises';
import { officialHashes, OfficialSourcesUnavailable } from '../../application/official-fixture.js';
import type { OfficialSourceName, OfficialSources } from '../../application/official-fixture.js';

export class FileOfficialSources implements OfficialSources {
  async read(name: OfficialSourceName): Promise<Uint8Array> {
    if (!Object.hasOwn(officialHashes, name)) throw new OfficialSourcesUnavailable();
    try {
      return await readFile(new URL('../../../../../../../fixtures/' + name, import.meta.url));
    } catch {
      throw new OfficialSourcesUnavailable();
    }
  }
}
