export const replaySize = 24;
export const replayRunLimit = 1000;
export const replayDiagnosticLimit = 4096;
export const replayStates = [
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
] as const;
export type ReplayState = (typeof replayStates)[number];
export type VerificationResult = 'pending' | 'conformant' | 'non_conformant' | 'inconclusive';
export type ReplayStage = 'first' | 'second' | 'exploratory';
export type AttemptState = 'in_flight' | 'classified' | 'uncertain' | 'technical_failure';
export type ReplayOutcome = 'accepted' | 'duplicate' | 'rejected';

export const replayFailureCodes = [
  'TRANSPORT_UNCERTAIN',
  'RESPONSE_PENDING',
  'RESPONSE_INVALID',
  'JOURNAL_UNCERTAIN',
  'NOT_ADMITTED',
  'PROCESSING_FAILED',
  'API_RESTARTED',
  'USER_RESTARTED',
  'VERIFICATION_CLOSED',
] as const;
export type ReplayFailureCode = (typeof replayFailureCodes)[number];

export class ReplayInvariantError extends Error {
  constructor() {
    super('El diario del reproductor no conserva sus invariantes.');
  }
}
export class ReplayConflict extends Error {
  constructor() {
    super('El estado del reproductor cambió o no permite esta transición.');
  }
}
export class ReplayInputError extends Error {
  constructor() {
    super('Los parámetros del reproductor no tienen el formato permitido.');
  }
}
export class ReplayCapacity extends Error {
  constructor() {
    super('El diario alcanzó su capacidad; conserva las ejecuciones existentes.');
  }
}

export function terminalReplay(state: ReplayState): boolean {
  return ['completed', 'stopped', 'error', 'interrupted'].includes(state);
}
export function replayInterval(value: unknown = 750): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 5000)
    throw new ReplayInputError();
  return value;
}

export interface AttemptPosition {
  readonly lineNumber: number;
  readonly state: AttemptState;
  readonly outcome: ReplayOutcome | null;
}
export interface ReplayProgress {
  readonly total: 24;
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly classified: number;
  readonly inFlight: number;
  readonly uncertain: number;
  readonly technicalFailure: number;
  readonly unattempted: number;
  readonly nextLine: number;
}

// Un intento incierto no se reclasifica a partir de una consulta posterior.
// El prefijo confirmado es la única fuente del cursor y sus tres contadores.
export function replayProgress(attempts: readonly AttemptPosition[]): ReplayProgress {
  const lines = new Set<number>();
  let accepted = 0,
    duplicates = 0,
    rejected = 0,
    inFlight = 0,
    uncertain = 0,
    technicalFailure = 0;
  for (const attempt of attempts) {
    if (
      !Number.isInteger(attempt.lineNumber) ||
      attempt.lineNumber < 1 ||
      attempt.lineNumber > replaySize ||
      lines.has(attempt.lineNumber)
    )
      throw new ReplayInvariantError();
    lines.add(attempt.lineNumber);
    if (attempt.state === 'classified') {
      if (attempt.outcome === 'accepted') accepted++;
      else if (attempt.outcome === 'duplicate') duplicates++;
      else if (attempt.outcome === 'rejected') rejected++;
      else throw new ReplayInvariantError();
    } else {
      if (attempt.outcome !== null) throw new ReplayInvariantError();
      if (attempt.state === 'in_flight') inFlight++;
      else if (attempt.state === 'uncertain') uncertain++;
      else if (attempt.state === 'technical_failure') technicalFailure++;
      else throw new ReplayInvariantError();
    }
  }
  const classified = accepted + duplicates + rejected;
  if (inFlight + uncertain + technicalFailure > 1) throw new ReplayInvariantError();
  for (const attempt of attempts) {
    if (
      (attempt.state === 'classified' && attempt.lineNumber > classified) ||
      (attempt.state !== 'classified' && attempt.lineNumber !== classified + 1)
    )
      throw new ReplayInvariantError();
  }
  return Object.freeze({
    total: 24,
    accepted,
    duplicates,
    rejected,
    classified,
    inFlight,
    uncertain,
    technicalFailure,
    unattempted: replaySize - attempts.length,
    nextLine: classified + 1,
  });
}

// Solo campos técnicos cerrados: no acepta mensajes, headers, cuerpos o causas.
// Se señala cualquier reducción, sin tocar outcome/reason del intento.
export function replayDiagnostic(
  code: ReplayFailureCode,
  details: Readonly<Record<string, unknown>> = {},
): string {
  if (!replayFailureCodes.includes(code)) throw new ReplayInvariantError();
  const result: Record<string, string | number | boolean> = { code, truncated: false };
  for (const [name, value] of Object.entries(details)) {
    if (
      (name === 'httpStatus' &&
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599) ||
      (name === 'receiptRevision' &&
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0) ||
      (['complete', 'resultsAvailable'].includes(name) && typeof value === 'boolean') ||
      (name === 'admission' &&
        typeof value === 'string' &&
        ['admitted', 'not_admitted', 'unknown'].includes(value))
    )
      result[name] = value as string | number | boolean;
    else result['truncated'] = true;
  }
  const document = JSON.stringify(result);
  if (Buffer.byteLength(document, 'utf8') > replayDiagnosticLimit) throw new ReplayInvariantError();
  return document;
}
