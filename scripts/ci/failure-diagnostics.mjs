const pressureStages = new Set([
  'connections',
  'released-capacity',
  ...Array.from({ length: 16 }, (_, index) => `ingest-${index * 8}`),
  ...Array.from({ length: 16 }, (_, index) => `fast-${index * 8}`),
]);

// Nunca imprime message/stack/actual arbitrarios: solo una etapa de la lista
// cerrada que devuelve el escenario. No altera el fallo ni el resultado del gate.
export function pressureFailureStage(error) {
  for (let depth = 0; error && typeof error === 'object' && depth < 4; depth++) {
    if (
      error.code === 'ERR_ASSERTION' &&
      error.expected === 'realtime-case-ok' &&
      typeof error.actual === 'string' &&
      error.actual.startsWith('realtime-pressure-failed:')
    ) {
      const stage = error.actual.slice('realtime-pressure-failed:'.length);
      return pressureStages.has(stage) ? stage : undefined;
    }
    error = error.cause;
  }
  return undefined;
}
