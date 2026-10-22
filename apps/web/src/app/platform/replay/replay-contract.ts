import type {
  ReplayControl,
  ReplayStreamFrame,
  ReplayAdmissionDto,
  ReplayCommandReceiptDto,
  ReplayDetailDto,
  ReplayHistoryDto,
  ReplayReportDto,
} from '@nexo/contracts';

export class ReplayProtocolError extends Error {
  constructor() {
    super('No se pudo comprobar la respuesta del reproductor.');
  }
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const uuid = (value: unknown) =>
  text(value) &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const integer = (value: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= lo && value <= hi;
const one = (value: unknown, values: readonly string[]) => text(value) && values.includes(value);
const nullable = (value: unknown, check: (value: unknown) => boolean) =>
  value === null || check(value);
const instant = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const sha = (value: unknown) => text(value) && /^[a-f0-9]{64}$/.test(value);
const environment = (value: unknown) =>
  object(value) &&
  uuid(value['instanceId']) &&
  typeof value['ready'] === 'boolean' &&
  sha(value['softwareFingerprint']) &&
  sha(value['configurationFingerprint']);
const actions = ['start', 'pause', 'resume', 'restart', 'finishVerification'];
const states = [
  'preparing',
  'running',
  'pausing',
  'paused',
  'restarting',
  'finalizing',
  'completed',
  'stopped',
  'error',
  'interrupted',
];
const verifications = ['pending', 'conformant', 'non_conformant', 'inconclusive'];
const stages = ['first', 'second', 'exploratory'];
function validProgress(v: unknown): boolean {
  if (
    !object(v) ||
    v['total'] !== 24 ||
    !['accepted', 'duplicates', 'rejected', 'classified', 'unattempted'].every((k) =>
      integer(v[k], 0, 24),
    ) ||
    !['inFlight', 'uncertain', 'technicalFailure'].every((k) => integer(v[k], 0, 1)) ||
    !integer(v['nextLine'], 1, 25)
  )
    return false;
  const n = (k: string) => v[k] as number;
  return (
    n('accepted') + n('duplicates') + n('rejected') === n('classified') &&
    n('inFlight') + n('uncertain') + n('technicalFailure') <= 1 &&
    n('classified') + n('inFlight') + n('uncertain') + n('technicalFailure') + n('unattempted') ===
      24 &&
    n('nextLine') === n('classified') + 1
  );
}
function run(v: unknown, summary = false): v is ObjectValue {
  return (
    object(v) &&
    uuid(v['runId']) &&
    uuid(v['scenarioId']) &&
    one(v['state'], states) &&
    one(v['stage'], stages) &&
    one(v['verification'], verifications) &&
    integer(v['intervalMs'], 100, 5000) &&
    integer(v['nextLine'], 1, 25) &&
    nullable(v['closeCode'], text) &&
    (!summary ||
      (uuid(v['instanceId']) &&
        nullable(v['previousRunId'], uuid) &&
        integer(v['revision']) &&
        instant(v['createdAt']) &&
        instant(v['updatedAt'])))
  );
}
function scenario(v: unknown): v is ObjectValue {
  return (
    object(v) &&
    uuid(v['scenarioId']) &&
    one(v['verification'], verifications) &&
    nullable(v['closedAt'], instant)
  );
}
export function readReplayControl(value: unknown): ReplayControl {
  if (
    !object(value) ||
    !uuid(value['instanceId']) ||
    !integer(value['controlVersion']) ||
    !integer(value['viewRevision']) ||
    !instant(value['observedAt']) ||
    !nullable(value['blockedReason'], (v) =>
      one(v, ['RECOVERING', 'JOURNAL_UNCERTAIN', 'SHUTTING_DOWN']),
    ) ||
    !nullable(value['pendingAction'], (v) => one(v, actions)) ||
    !Array.isArray(value['allowedActions']) ||
    value['allowedActions'].length > 5 ||
    !value['allowedActions'].every((v) => one(v, actions)) ||
    new Set(value['allowedActions']).size !== value['allowedActions'].length ||
    !nullable(value['scenario'], scenario)
  )
    throw new ReplayProtocolError();
  const current = value['run'];
  if (
    current !== null &&
    (!run(current) ||
      !validProgress(current['progress']) ||
      current['nextLine'] !== (current['progress'] as ObjectValue)['nextLine'])
  )
    throw new ReplayProtocolError();
  return value as unknown as ReplayControl;
}
export function readReplayFrame(data: string): ReplayStreamFrame {
  try {
    if (data.length > 16384) throw new ReplayProtocolError();
    const value: unknown = JSON.parse(data);
    if (
      !object(value) ||
      value['type'] !== 'demo.replay.updated' ||
      value['schemaVersion'] !== 1 ||
      !uuid(value['streamInstanceId'])
    )
      throw new ReplayProtocolError();
    readReplayControl(value);
    return value as unknown as ReplayStreamFrame;
  } catch {
    throw new ReplayProtocolError();
  }
}
export function readReplayAdmission(
  value: unknown,
  commandId: string,
  instanceId: string,
): ReplayAdmissionDto {
  if (
    !object(value) ||
    value['commandId'] !== commandId ||
    value['instanceId'] !== instanceId ||
    !uuid(value['runId']) ||
    !integer(value['admittedControlVersion']) ||
    value['accepted'] !== true
  )
    throw new ReplayProtocolError();
  return value as unknown as ReplayAdmissionDto;
}
export function readReplayReceipt(
  value: unknown,
  commandId: string,
  instanceId: string,
): ReplayCommandReceiptDto {
  if (
    !object(value) ||
    !one(value['resolution'], ['pending', 'completed', 'failed']) ||
    !nullable(value['reasonCode'], text)
  )
    throw new ReplayProtocolError();
  readReplayAdmission(value['admission'], commandId, instanceId);
  if ((value['resolution'] === 'failed') !== (value['reasonCode'] !== null))
    throw new ReplayProtocolError();
  return value as unknown as ReplayCommandReceiptDto;
}
function report(v: unknown): v is ReplayReportDto {
  return (
    object(v) &&
    v['version'] === 1 &&
    v['scope'] === 'data-and-replays' &&
    one(v['phase'], ['preparation', 'first', 'second']) &&
    one(v['result'], verifications.slice(1)) &&
    nullable(v['observedAt'], instant) &&
    instant(v['attemptedAt']) &&
    nullable(v['runId'], uuid) &&
    nullable(v['scenarioId'], uuid) &&
    nullable(v['runRevision'], integer) &&
    nullable(v['snapshotFingerprint'], sha) &&
    nullable(v['environment'], environment) &&
    object(v['sources']) &&
    Object.values(v['sources']).every(sha) &&
    Array.isArray(v['checks']) &&
    v['checks'].length <= 256 &&
    v['checks'].every(
      (c) =>
        object(c) &&
        ['key', 'label', 'source'].every((k) => text(c[k])) &&
        Object.hasOwn(c, 'expected') &&
        Object.hasOwn(c, 'observed') &&
        one(c['state'], ['pending', 'matches', 'differs', 'unavailable']),
    ) &&
    object(v['externalEvidence']) &&
    ['twoRenderedClients', 'pauseResume', 'ci', 'video'].every(
      (k) => (v['externalEvidence'] as ObjectValue)[k] === 'not_assessed',
    )
  );
}
export function readReplayReport(value: unknown): ReplayReportDto {
  if (!report(value)) throw new ReplayProtocolError();
  return value;
}
export function readReplayDetail(v: unknown, runId: string): ReplayDetailDto {
  if (
    !object(v) ||
    !run(v['run'], true) ||
    v['run']['runId'] !== runId ||
    !validProgress(v['progress']) ||
    !scenario(v['scenario']) ||
    !nullable(v['scenario']['report'], report) ||
    !object(v['inspection']) ||
    !report(v['inspection']['report']) ||
    !one(v['inspection']['currentState'], ['same', 'changed', 'unavailable']) ||
    !nullable(v['inspection']['currentObservedAt'], instant) ||
    !Array.isArray(v['attempts']) ||
    v['attempts'].length > 24
  )
    throw new ReplayProtocolError();
  const positions = new Set<number>();
  for (const a of v['attempts']) {
    if (
      !object(a) ||
      a['runId'] !== runId ||
      !integer(a['lineNumber'], 1, 24) ||
      positions.has(a['lineNumber']) ||
      a['batchIndex'] !== 0 ||
      !uuid(a['ingestionId']) ||
      !nullable(a['eventId'], text) ||
      !one(a['state'], ['in_flight', 'classified', 'uncertain', 'technical_failure']) ||
      !nullable(a['outcome'], (o) => one(o, ['accepted', 'duplicate', 'rejected'])) ||
      !nullable(a['reasonCode'], text) ||
      !nullable(a['httpStatus'], (o) => integer(o, 100, 599)) ||
      !nullable(
        a['diagnostic'],
        (o) =>
          object(o) &&
          Object.values(o).every(
            (v) =>
              text(v) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)),
          ),
      ) ||
      !instant(a['startedAt']) ||
      !nullable(a['finalizedAt'], instant)
    )
      throw new ReplayProtocolError();
    positions.add(a['lineNumber']);
  }
  return v as unknown as ReplayDetailDto;
}
export function readReplayHistory(value: unknown): ReplayHistoryDto {
  if (
    !object(value) ||
    !Array.isArray(value['items']) ||
    value['items'].length > 100 ||
    !value['items'].every((v) => run(v, true)) ||
    !nullable(value['nextCursor'], (v) => text(v) && /^[a-zA-Z0-9_-]{1,512}$/.test(v))
  )
    throw new ReplayProtocolError();
  return value as unknown as ReplayHistoryDto;
}
