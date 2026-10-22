export const browserSetupSteps = Object.freeze({
  download: Object.freeze({
    program: process.execPath,
    args: ['node_modules/@playwright/test/cli.js', 'install', '--only-shell', 'chromium'],
    timeout: 300000,
  }),
  dependencies: Object.freeze({
    program: process.execPath,
    args: ['node_modules/@playwright/test/cli.js', 'install-deps', 'chromium'],
    timeout: 300000,
  }),
  probe: Object.freeze({
    program: process.execPath,
    args: ['scripts/ci/probe-browser.mjs'],
    timeout: 30000,
  }),
});

export function missingBrowserDependencies(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    (/Host system is missing dependencies to run browsers\./.test(error.message) ||
      /error while loading shared libraries: [a-zA-Z0-9_.+-]+: cannot open shared object file/.test(
        error.message,
      ))
  );
}
function successful(result) {
  return result?.status === 0 && !result.signal && !result.error;
}
function probeState(result) {
  if (
    !result ||
    result.signal ||
    result.error ||
    typeof result.stdout !== 'string' ||
    Buffer.byteLength(result.stdout) > 256
  )
    return 'invalid';
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return 'invalid';
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1
  )
    return 'invalid';
  if (successful(result) && value.state === 'ready') return 'ready';
  if (result.status === 2 && value.state === 'missing-dependencies') return 'missing';
  return 'invalid';
}
function fail(step) {
  throw new Error(`No se pudo preparar Chromium: ${step}.`);
}
// run ejecuta únicamente un paso de la lista cerrada y conserva su salida como
// diagnóstico privado. Esta preparación nunca decide el resultado de pruebas.
export async function prepareChromium(run) {
  if (!successful(await run('download'))) fail('download');
  const state = probeState(await run('probe'));
  if (state === 'ready') return;
  if (state !== 'missing') fail('probe');
  if (!successful(await run('dependencies'))) fail('dependencies');
  if (probeState(await run('probe')) !== 'ready') fail('probe-after-dependencies');
}
