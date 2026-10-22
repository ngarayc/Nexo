import { readReplayUuid } from '../../domain/command.js';
import { ReplayInputError } from '../../domain/replay.js';

export type ReplayQuery =
  | { view: 'current' }
  | { view: 'run'; runId: string }
  | { view: 'history'; limit: number; cursor?: string }
  | { view: 'command'; commandId: string; instanceId: string };

export function readReplayQuery(value: unknown): ReplayQuery {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ReplayInputError();
  const query = value as Record<string, unknown>,
    keys = Object.keys(query);
  if (!keys.length) return { view: 'current' };
  const only = (allowed: readonly string[]) => keys.every((key) => allowed.includes(key));
  if (only(['runId']) && keys.length === 1)
    return { view: 'run', runId: readReplayUuid(query['runId']) };
  if (only(['commandId', 'instanceId']) && keys.length === 2)
    return {
      view: 'command',
      commandId: readReplayUuid(query['commandId']),
      instanceId: readReplayUuid(query['instanceId']),
    };
  if (query['view'] === 'history' && only(['view', 'limit', 'cursor'])) {
    const raw = query['limit'];
    if (raw !== undefined && (typeof raw !== 'string' || !/^[1-9]\d{0,2}$/.test(raw)))
      throw new ReplayInputError();
    const limit = raw === undefined ? 20 : Number(raw);
    if (limit > 100) throw new ReplayInputError();
    const cursor = query['cursor'];
    if (
      cursor !== undefined &&
      (typeof cursor !== 'string' ||
        cursor.length < 1 ||
        cursor.length > 512 ||
        !/^[a-zA-Z0-9_-]+$/.test(cursor))
    )
      throw new ReplayInputError();
    return { view: 'history', limit, ...(cursor === undefined ? {} : { cursor }) };
  }
  throw new ReplayInputError();
}
