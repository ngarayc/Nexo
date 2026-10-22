import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  prepareChromium,
  missingBrowserDependencies,
  browserSetupSteps,
} from './browser-setup.mjs';

const result = (state = 'ready', status = 0) => ({
  status,
  signal: null,
  stdout: JSON.stringify({ state }),
});
function runner(probes, overrides = {}) {
  const calls = [];
  return {
    calls,
    run: async (step) => {
      calls.push(step);
      return overrides[step] ?? (step === 'probe' ? probes.shift() : result());
    },
  };
}
test('un Chromium comprobado no requiere instalar paquetes del sistema', async () => {
  const setup = runner([result()]);
  await prepareChromium(setup.run);
  assert.deepEqual(setup.calls, ['download', 'probe']);
  assert.deepEqual(browserSetupSteps.download.args.slice(-3), [
    'install',
    '--only-shell',
    'chromium',
  ]);
});
test('dependencias faltantes exigen instalación y otra comprobación real antes de continuar', async () => {
  const setup = runner([result('missing-dependencies', 2), result()]);
  await prepareChromium(setup.run);
  assert.deepEqual(setup.calls, ['download', 'probe', 'dependencies', 'probe']);
});
test('fallo genérico o salida inválida no se transforma en instalación o éxito', async () => {
  for (const probe of [
    result('failed', 1),
    result('missing-dependencies', 0),
    result('ready', 1),
    { ...result(), stdout: 'synthetic-private-marker' },
    { ...result(), stdout: '{"state":"ready","extra":"synthetic-private-marker"}' },
    { ...result(), signal: 'SIGTERM' },
    { ...result(), error: new Error('synthetic-private-marker') },
  ]) {
    const setup = runner([probe]);
    await assert.rejects(prepareChromium(setup.run), (error) => {
      assert.equal(error.message, 'No se pudo preparar Chromium: probe.');
      return true;
    });
    assert.deepEqual(setup.calls, ['download', 'probe']);
  }
});
test('descarga o instalación fallidas detienen sin saltar controles', async () => {
  for (const step of ['download', 'dependencies']) {
    for (const failure of [
      { status: 1 },
      { status: null, signal: 'SIGTERM' },
      { error: new Error('synthetic-private-marker') },
    ]) {
      const setup = runner([result('missing-dependencies', 2)], { [step]: failure });
      await assert.rejects(prepareChromium(setup.run), {
        message: `No se pudo preparar Chromium: ${step}.`,
      });
      assert.equal(setup.calls.at(-1), step);
    }
  }
});
test('dependencias aún ausentes después de instalar bloquean sin bucle de reintento', async () => {
  const setup = runner([result('missing-dependencies', 2), result('missing-dependencies', 2)]);
  await assert.rejects(prepareChromium(setup.run), {
    message: 'No se pudo preparar Chromium: probe-after-dependencies.',
  });
  assert.deepEqual(setup.calls, ['download', 'probe', 'dependencies', 'probe']);
});
test('solo el diagnóstico nativo conocido permite el fallback, sin propagar mensajes', () => {
  for (const message of [
    'Host system is missing dependencies to run browsers.',
    'chromium: error while loading shared libraries: libExample.so.1: cannot open shared object file: No such file',
  ])
    assert.equal(missingBrowserDependencies(new Error(message)), true);
  for (const error of [
    null,
    {},
    new Error('synthetic-private-marker'),
    new Error('Executable does not exist'),
  ])
    assert.equal(missingBrowserDependencies(error), false);
});
