import { batchLimits } from '../../domain/batch.js';
import type { BatchLimits } from '../../domain/batch.js';

export function readIngestionLimits(env: NodeJS.ProcessEnv): BatchLimits {
  const configured = (name: string, maximum: number) => {
    const raw = env[name];
    if (raw === undefined) return maximum;
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(`Configuración inválida: ${name}.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > maximum)
      throw new Error(`${name} excede el perfil de ingesta soportado.`);
    return value;
  };
  return Object.freeze({
    bodyBytes: configured('INGEST_MAX_BODY_BYTES', batchLimits.bodyBytes),
    events: configured('INGEST_MAX_EVENTS_PER_BATCH', batchLimits.events),
  });
}
