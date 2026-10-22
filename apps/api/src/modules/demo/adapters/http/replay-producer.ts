import type {
  ReplayDelivery,
  ReplayLine,
  SendReplayLine,
} from '../../application/send-replay-line.js';
import { readReplayUuid } from '../../domain/command.js';
import { replayDiagnostic } from '../../domain/replay.js';
import type { ReplayFailureCode, ReplayOutcome } from '../../domain/replay.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = (value: unknown) => Array.isArray(value) && value.length === 0;
function stopped(
  code: ReplayFailureCode,
  status: number | null,
  admission: 'admitted' | 'not_admitted' | 'unknown' = 'unknown',
  revision?: number,
): ReplayDelivery {
  return {
    state:
      code === 'NOT_ADMITTED' || code === 'PROCESSING_FAILED' ? 'technical_failure' : 'uncertain',
    closeCode: code,
    httpStatus: status,
    diagnosticDocument: replayDiagnostic(code, {
      ...(status === null ? {} : { httpStatus: status }),
      admission,
      ...(revision === undefined ? {} : { receiptRevision: revision }),
    }),
  };
}
const notAdmitted: Readonly<Record<string, number>> = {
  INVALID_API_KEY: 403,
  MALFORMED_JSON: 400,
  INVALID_BATCH: 400,
  EMPTY_BATCH: 400,
  BODY_TOO_LARGE: 413,
  BATCH_TOO_LARGE: 413,
  INVALID_IDEMPOTENCY_KEY: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INGESTION_ID_CONFLICT: 409,
  INGESTION_CAPACITY_EXCEEDED: 503,
  RATE_LIMITED: 429,
  REQUEST_TIMEOUT: 408,
  INGESTION_STATUS_UNAVAILABLE: 503,
};

export function readReplayIngestionResponse(
  status: number,
  value: unknown,
  ingestionId: string,
  eventId: string,
): ReplayDelivery {
  if (!object(value)) return stopped('RESPONSE_INVALID', status);
  const revision =
    typeof value['revision'] === 'number' &&
    Number.isSafeInteger(value['revision']) &&
    value['revision'] >= 0
      ? value['revision']
      : undefined;
  if (status !== 200) {
    const code = value['code'];
    if (
      typeof code === 'string' &&
      Object.hasOwn(notAdmitted, code) &&
      notAdmitted[code] === status &&
      value['admission'] === 'not_admitted' &&
      value['resultsAvailable'] === false &&
      ['accepted', 'duplicates', 'rejected'].every((key) => value[key] === 0) &&
      empty(value['errors']) &&
      (value['ingestionId'] === undefined || value['ingestionId'] === ingestionId)
    )
      return stopped('NOT_ADMITTED', status, 'not_admitted');
    if (
      value['ingestionId'] === ingestionId &&
      value['admission'] === 'admitted' &&
      value['resultsAvailable'] === true &&
      value['complete'] === false &&
      revision !== undefined
    ) {
      if (status === 503 && code === 'INGESTION_RESULT_PENDING')
        return stopped('RESPONSE_PENDING', status, 'admitted', revision);
      if (
        status === 500 &&
        code === 'INGESTION_PROCESSING_FAILED' &&
        Array.isArray(value['failedIndexes']) &&
        value['failedIndexes'].length > 0
      )
        return stopped('PROCESSING_FAILED', status, 'admitted', revision);
    }
    if (
      status === 503 &&
      code === 'INGESTION_STATUS_UNAVAILABLE' &&
      value['ingestionId'] === ingestionId &&
      value['resultsAvailable'] === false &&
      (value['admission'] === 'admitted' || value['admission'] === 'unknown')
    )
      return stopped('RESPONSE_PENDING', status, value['admission'], revision);
    return stopped('RESPONSE_INVALID', status);
  }
  const results = value['results'],
    errors = value['errors'];
  if (
    value['ingestionId'] !== ingestionId ||
    value['total'] !== 1 ||
    value['complete'] !== true ||
    revision === undefined ||
    !empty(value['pendingIndexes']) ||
    !empty(value['failedIndexes']) ||
    !empty(value['failures']) ||
    !Array.isArray(results) ||
    results.length !== 1 ||
    !Array.isArray(errors) ||
    !object(results[0])
  )
    return stopped('RESPONSE_INVALID', status);
  const result = results[0],
    outcome = result['outcome'];
  if (
    result['index'] !== 0 ||
    result['eventId'] !== eventId ||
    typeof outcome !== 'string' ||
    !['accepted', 'duplicate', 'rejected'].includes(outcome)
  )
    return stopped('RESPONSE_INVALID', status);
  for (const [key, expectedOutcome] of [
    ['accepted', 'accepted'],
    ['duplicates', 'duplicate'],
    ['rejected', 'rejected'],
  ])
    if (value[key!] !== (outcome === expectedOutcome ? 1 : 0))
      return stopped('RESPONSE_INVALID', status);
  if (outcome !== 'rejected')
    return errors.length === 0
      ? { state: 'classified', outcome: outcome as ReplayOutcome, reasonCode: null }
      : stopped('RESPONSE_INVALID', status);
  const error = errors[0];
  if (
    errors.length !== 1 ||
    !object(error) ||
    error['index'] !== 0 ||
    error['eventId'] !== eventId ||
    typeof error['reason'] !== 'string' ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(error['reason'])
  )
    return stopped('RESPONSE_INVALID', status);
  return { state: 'classified', outcome: 'rejected', reasonCode: error['reason'] };
}

// El destino y las cabeceras los determina el servidor; no son una entrada del
// comando. Cada llamada hace una sola petición y nunca consulta/reenvía recibos.
export class LoopbackReplayProducer implements SendReplayLine {
  readonly #key: string;
  readonly #target: string;
  constructor(
    port: number,
    key: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/.test(key))
      throw new Error('Configuración del emisor no disponible.');
    this.#key = key;
    this.#target = `http://127.0.0.1:${port}/api/events/batch`;
  }
  async send(line: ReplayLine, ingestionId: string, signal: AbortSignal): Promise<ReplayDelivery> {
    const identity = readReplayUuid(ingestionId);
    let status: number | null = null;
    try {
      const response = await this.request(this.#target, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.#key,
          'Idempotency-Key': identity,
        },
        body: line.body,
      });
      status =
        Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
          ? response.status
          : null;
      if (
        status === null ||
        !/^application\/(?:problem\+)?json(?:\s*;\s*charset=utf-8)?$/i.test(
          response.headers.get('content-type') ?? '',
        )
      ) {
        await response.body?.cancel();
        return stopped('RESPONSE_INVALID', status);
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16384)) {
        await response.body?.cancel();
        return stopped('RESPONSE_INVALID', status);
      }
      const reader = response.body?.getReader();
      if (!reader) return stopped('RESPONSE_INVALID', status);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return stopped('RESPONSE_INVALID', status);
        }
        chunks.push(value);
      }
      let document: unknown;
      try {
        document = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)),
        );
      } catch {
        return stopped('RESPONSE_INVALID', status);
      }
      return readReplayIngestionResponse(status, document, identity, line.eventId);
    } catch {
      return stopped('TRANSPORT_UNCERTAIN', status);
    }
  }
}
