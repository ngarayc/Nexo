import { TelemetryInvariantError } from '../../telemetry/public.js';
import { IngestionInvariantError } from '../domain/recovery-policy.js';
import type { TechnicalCode } from '../domain/recovery-policy.js';

// Frontera de serialización del broker: conserva diagnóstico cerrado sin
// aceptar una causa que pueda contener SQL, credenciales o payload.
export class UnconfirmedIngestionWork extends Error {
  constructor(readonly code: TechnicalCode = 'PROCESSING_UNCONFIRMED') {
    super('INGESTION_WORK_UNCONFIRMED');
  }
}

export function processingFailure(error: unknown): TechnicalCode {
  const seen = new Set<object>();
  for (
    let depth = 0;
    depth < 5 && typeof error === 'object' && error !== null && !seen.has(error);
    depth++
  ) {
    seen.add(error);
    if (error instanceof TelemetryInvariantError || error instanceof IngestionInvariantError)
      return 'INGESTION_INVARIANT';
    const record = error as Record<string, unknown>;
    const code = record['code'];
    if (typeof code === 'string') {
      if (/^42[A-Z0-9]{3}$/.test(code)) return 'SCHEMA_INCOMPATIBLE';
      if (code === '23503' || code === '23514') return 'INGESTION_INVARIANT';
    }
    error = record['cause'];
  }
  return 'PROCESSING_UNCONFIRMED';
}
