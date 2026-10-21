import { ProblemDetailsError } from '../../../../platform/http/problem.js';

const titles = {
  400: 'Solicitud incorrecta',
  403: 'Acceso denegado',
  404: 'No encontrado',
  408: 'Tiempo de espera agotado',
  409: 'Conflicto',
  413: 'Contenido demasiado grande',
  415: 'Tipo de contenido no admitido',
  429: 'Demasiadas solicitudes',
  500: 'Error interno del servidor',
  503: 'Servicio no disponible',
} as const;

const definitions = {
  INVALID_API_KEY: [403, 'No fue posible autorizar el productor.'],
  MALFORMED_JSON: [400, 'El cuerpo no contiene un documento JSON UTF-8 válido.'],
  INVALID_BATCH: [400, 'Envía un objeto con un arreglo events.'],
  EMPTY_BATCH: [400, 'El arreglo events debe tener al menos una posición.'],
  BODY_TOO_LARGE: [413, 'El cuerpo supera el máximo admitido.'],
  BATCH_TOO_LARGE: [413, 'El lote supera el máximo admitido.'],
  INVALID_IDEMPOTENCY_KEY: [400, 'Idempotency-Key debe ser un UUID v4.'],
  INVALID_INGESTION_ID: [400, 'El identificador de recepción debe ser un UUID v4.'],
  INGESTION_NOT_FOUND: [404, 'No se encontró una recepción visible con ese identificador.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Usa application/json UTF-8 sin compresión.'],
  INGESTION_ID_CONFLICT: [409, 'La recepción existente representa otro cuerpo.'],
  INGESTION_CAPACITY_EXCEEDED: [503, 'No fue posible reservar capacidad para una recepción nueva.'],
  RATE_LIMITED: [429, 'Espera antes de intentarlo de nuevo.'],
  INGESTION_RESULT_PENDING: [
    503,
    'El servidor conserva el lote y su procesamiento puede continuar.',
  ],
  INGESTION_PROCESSING_FAILED: [
    500,
    'Hay posiciones detenidas por un fallo técnico; conserva el recibo.',
  ],
  INGESTION_STATUS_UNAVAILABLE: [
    503,
    'No se puede confirmar ahora el resultado durable; conserva el identificador.',
  ],
  REQUEST_TIMEOUT: [408, 'El cuerpo no se recibió dentro del plazo disponible.'],
  DEMO_DISABLED: [404, 'La interfaz de demo no está habilitada.'],
} as const;

export type IngestionProblemCode = keyof typeof definitions;

export function ingestionProblem(
  code: IngestionProblemCode,
  requestId: string,
  extensions: Readonly<Record<string, unknown>> = {},
): ProblemDetailsError {
  const [status, detail] = definitions[code];
  const title = titles[status];
  return new ProblemDetailsError({
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    errors: [],
    admission: 'not_admitted',
    resultsAvailable: false,
    ...extensions,
    type: 'about:blank',
    title,
    status,
    detail,
    code,
    requestId,
  });
}
