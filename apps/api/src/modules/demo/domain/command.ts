import { ReplayConflict, ReplayInputError, replayInterval } from './replay.js';

export const replayActions = ['start', 'pause', 'resume', 'restart', 'finishVerification'] as const;
export type ReplayAction = (typeof replayActions)[number];
export interface ReplayCommand {
  readonly commandId: string;
  readonly instanceId: string;
  readonly expectedControlVersion: number;
  readonly runId: string | null;
  readonly action: ReplayAction;
  readonly intervalMs?: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function readReplayUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ReplayInputError();
  return value.toLowerCase();
}
export function readReplayCommand(value: unknown): ReplayCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ReplayInputError();
  const input = value as Record<string, unknown>,
    required = ['commandId', 'instanceId', 'expectedControlVersion', 'runId', 'action'];
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => ![...required, 'intervalMs'].includes(key))
  )
    throw new ReplayInputError();
  const action = input['action'];
  if (typeof action !== 'string' || !replayActions.includes(action as ReplayAction))
    throw new ReplayInputError();
  const version = input['expectedControlVersion'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
    throw new ReplayInputError();
  const runId = input['runId'] === null ? null : readReplayUuid(input['runId']);
  if ((action === 'start') !== (runId === null)) throw new ReplayInputError();
  const interval = input['intervalMs'];
  if (
    Object.hasOwn(input, 'intervalMs') &&
    (!['start', 'restart', 'resume'].includes(action) || typeof interval !== 'number')
  )
    throw new ReplayInputError();
  return Object.freeze({
    commandId: readReplayUuid(input['commandId']),
    instanceId: readReplayUuid(input['instanceId']),
    expectedControlVersion: version,
    runId,
    action: action as ReplayAction,
    ...(Object.hasOwn(input, 'intervalMs') ? { intervalMs: replayInterval(interval) } : {}),
  });
}
export function replayCommandDocument(command: ReplayCommand): string {
  return JSON.stringify(readReplayCommand(command));
}
export function sameReplayCommand(document: string, command: ReplayCommand): void {
  if (document !== replayCommandDocument(command)) throw new ReplayConflict();
}
