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

// Solo se publica una categoría cerrada; mensajes, trazas y datos del reporte
// permanecen privados. La clasificación nunca decide el resultado del job.
export function browserFailureStage(report) {
  const pending = [report];
  const visited = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    if (typeof node.message === 'string' && node.message.includes('strict mode violation:'))
      return 'locator-ambiguity';
    for (const key of ['suites', 'specs', 'tests', 'results', 'errors'])
      if (Array.isArray(node[key])) pending.push(...node[key]);
  }
  return undefined;
}

// Solo números de línea del archivo de prueba conocido. Nunca texto del error,
// rutas personales o datos de navegador; la clasificación no decide el gate.
export function browserFailureLines(report, file) {
  if (!/^[a-z0-9-]+\.spec\.mjs$/u.test(file)) return [];
  const pending = [report],
    visited = new Set(),
    lines = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    const location = node.location;
    if (
      typeof location?.file === 'string' &&
      location.file.split(/[\\/]/u).at(-1) === file &&
      Number.isInteger(location.line) &&
      location.line > 0 &&
      location.line <= 20000
    )
      lines.add(location.line);
    for (const key of ['suites', 'specs', 'tests', 'results', 'errors'])
      if (Array.isArray(node[key])) pending.push(...node[key]);
  }
  return [...lines].sort((a, b) => a - b);
}
