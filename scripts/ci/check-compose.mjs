import { testStack } from '../../tests/support/stack.mjs';
import { validateCompose } from './compose-policy.mjs';

const stack = testStack();
try {
  // El JSON expandido contiene secretos sintéticos: se analiza en memoria, sin publicarlo.
  validateCompose(JSON.parse(stack.compose('config', '--format', 'json')));
  console.log('Compose: tres servicios, puertos de loopback, montajes y privilegios válidos.');
} finally {
  stack.close();
}
