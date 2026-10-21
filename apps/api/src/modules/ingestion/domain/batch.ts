import { OriginalJson, InvalidJsonError } from '../../telemetry/public.js';

export type AdmissionCode =
  | 'MALFORMED_JSON'
  | 'INVALID_BATCH'
  | 'EMPTY_BATCH'
  | 'BODY_TOO_LARGE'
  | 'BATCH_TOO_LARGE'
  | 'INVALID_IDEMPOTENCY_KEY';

export class AdmissionError extends Error {
  constructor(readonly code: AdmissionCode) {
    super(code);
  }
}

export interface BatchInput {
  readonly document: OriginalJson;
  readonly items: readonly OriginalJson[];
  readonly inputBytes: bigint;
}

export const batchLimits = Object.freeze({ bodyBytes: 2 * 1024 * 1024, events: 1000 });
export interface BatchLimits {
  readonly bodyBytes: number;
  readonly events: number;
}

export function readBatch(source: string, limits: BatchLimits = batchLimits): BatchInput {
  const bytes = Buffer.byteLength(source);
  if (bytes > limits.bodyBytes) throw new AdmissionError('BODY_TOO_LARGE');
  let document: OriginalJson;
  try {
    document = OriginalJson.parse(source);
  } catch (error) {
    if (error instanceof InvalidJsonError) throw new AdmissionError('MALFORMED_JSON');
    throw error;
  }
  const events = document.kind === 'object' ? document.property('events') : undefined;
  if (events?.kind !== 'array') throw new AdmissionError('INVALID_BATCH');
  const total = events.arrayLength!;
  if (total === 0) throw new AdmissionError('EMPTY_BATCH');
  if (total > limits.events) throw new AdmissionError('BATCH_TOO_LARGE');
  const items = events.elements()!;
  const inputBytes = BigInt(
    bytes + items.reduce((sum, item) => sum + Buffer.byteLength(item.raw), 0),
  );
  return Object.freeze({ document, items, inputBytes });
}

export function readIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return;
  if (
    typeof value !== 'string' ||
    !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)
  ) {
    throw new AdmissionError('INVALID_IDEMPOTENCY_KEY');
  }
  return value.toLowerCase();
}
