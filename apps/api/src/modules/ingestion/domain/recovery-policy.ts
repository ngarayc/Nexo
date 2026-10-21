export type TechnicalCode =
  | 'PROCESSING_UNCONFIRMED'
  | 'JOB_MISSING'
  | 'JOB_FAILED'
  | 'QUEUE_CANCELLED'
  | 'QUEUE_PROTOCOL_VIOLATION'
  | 'SCHEMA_INCOMPATIBLE'
  | 'INGESTION_INVARIANT';

const requiresIntervention = new Set<TechnicalCode>([
  'QUEUE_CANCELLED',
  'QUEUE_PROTOCOL_VIOLATION',
  'SCHEMA_INCOMPATIBLE',
  'INGESTION_INVARIANT',
]);

export function isRecoverable(code: TechnicalCode): boolean {
  return !requiresIntervention.has(code);
}

export function recoveryWindow(generation: number): {
  readonly baseMilliseconds: number;
  readonly maximumJitterMilliseconds: number;
} {
  if (generation !== 1 && generation !== 2)
    throw new Error('No corresponde reservar otra oportunidad de esta política.');
  const baseMilliseconds = generation === 1 ? 2000 : 4000;
  return { baseMilliseconds, maximumJitterMilliseconds: baseMilliseconds / 4 };
}

export class IngestionInvariantError extends Error {
  constructor() {
    super('La coordinación durable de la ingesta es incoherente.');
  }
}
