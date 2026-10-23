import { testStack } from './stack.mjs';

// El mismo perfil se utiliza en Chromium y en el recorrido ampliado. Solo
// estos casos necesitan reservar el origen público para el intermediario TCP.
const cutFiles = new Set([
  'alerts-filter-live.spec.mjs',
  'realtime-recovery.spec.mjs',
  'visualization-coherence.spec.mjs',
]);

export function browserStack(file) {
  return testStack({ webPort: 8081, publishWeb: cutFiles.has(file) ? 'ephemeral' : true });
}
