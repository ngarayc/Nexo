export { OriginalJson, InvalidJsonError } from './domain/original-json.js';
export { ClassifyTelemetry, TelemetryInvariantError } from './application/classify.js';
export type { Classification } from './application/classify.js';
export { TelemetryTransaction } from './adapters/postgres/telemetry-transaction.js';
export { encodeIdentity, decodeIdentity } from './domain/identity.js';
export { observedInstantUtc } from './domain/observed-instant.js';
export { vehicleState } from './domain/event.js';
export type { EventView, VehicleState } from './domain/event.js';
