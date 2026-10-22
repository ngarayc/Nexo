import { requiredJobs } from './policy.mjs';

const expectedChecks = {
  quality: ['workspace-quality', 'traceability', 'ci-controls'],
  unit: ['api', 'web'],
  integration: ['postgresql'],
  'security-source': ['secrets', 'dependencies', 'configuration'],
  system: ['images', 'browser', 'persistence'],
};

export function validateReport(report, { job, sha, runId, attempt }) {
  if (
    !/^[0-9a-f]{40}$/.test(sha ?? '') ||
    !/^[1-9]\d*$/.test(runId ?? '') ||
    !/^[1-9]\d*$/.test(attempt ?? '') ||
    report?.version !== 1 ||
    report.job !== job ||
    report.sha !== sha ||
    report.runId !== runId ||
    report.attempt !== attempt ||
    !requiredJobs.includes(job) ||
    Object.keys(report).some(
      (name) => !['version', 'job', 'sha', 'runId', 'attempt', 'checks'].includes(name),
    )
  ) {
    throw new Error('Reporte ausente, de otro candidato o de otra ejecución.');
  }
  const checks = report.checks;
  const names = expectedChecks[job];
  if (
    !Array.isArray(checks) ||
    checks.length !== names.length ||
    names.some(
      (name) =>
        checks.filter((check) => check.name === name && check.status === 'passed').length !== 1,
    )
  ) {
    throw new Error('Comprobaciones obligatorias incompletas.');
  }
  for (const check of checks) {
    if (Object.keys(check).some((name) => !['name', 'status', 'tests'].includes(name))) {
      throw new Error('El reporte contiene campos fuera de la lista publicable.');
    }
    if (['api', 'web', 'postgresql', 'browser'].includes(check.name)) {
      const { total, passed, failed, skipped } = check.tests ?? {};
      if (
        !Number.isSafeInteger(total) ||
        total <= 0 ||
        passed !== total ||
        failed !== 0 ||
        skipped !== 0
      ) {
        throw new Error('Suite vacía, incompleta, omitida o fallida.');
      }
      if (
        Object.keys(check.tests).some(
          (name) => !['total', 'passed', 'failed', 'skipped'].includes(name),
        )
      ) {
        throw new Error('El reporte contiene campos fuera de la lista publicable.');
      }
    } else if ('tests' in check) {
      throw new Error('Métricas de prueba inesperadas.');
    }
  }
}

export function validateGate({ results, reports, sha, runId, attempt }) {
  for (const job of requiredJobs) {
    if (results?.[job] !== 'success')
      throw new Error(`Control obligatorio no satisfactorio: ${job}.`);
    validateReport(reports?.[job], { job, sha, runId, attempt });
  }
}

export function validateVitestReport(report, expectedFiles) {
  if (
    !Array.isArray(expectedFiles) ||
    expectedFiles.length === 0 ||
    new Set(expectedFiles).size !== expectedFiles.length
  ) {
    throw new Error('Inventario de pruebas vacío o ambiguo.');
  }
  if (
    report?.success !== true ||
    !Number.isSafeInteger(report.numTotalTests) ||
    report.numTotalTests <= 0 ||
    report.numPassedTests !== report.numTotalTests ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    !Array.isArray(report.testResults) ||
    report.testResults.length !== expectedFiles.length
  ) {
    throw new Error('Resultado de pruebas vacío, fallido o con omisiones.');
  }
  let assertions = 0;
  for (const file of expectedFiles) {
    const suites = report.testResults.filter(
      (suite) => suite.name === file || suite.name?.endsWith(`/${file}`),
    );
    if (
      suites.length !== 1 ||
      suites[0].status !== 'passed' ||
      !suites[0].assertionResults?.length
    ) {
      throw new Error('Falta una suite del inventario de pruebas.');
    }
    for (const assertion of suites[0].assertionResults) {
      if (assertion.status !== 'passed') throw new Error('Existe una prueba omitida o fallida.');
      assertions += 1;
    }
  }
  if (assertions !== report.numTotalTests) throw new Error('Conteo de pruebas inconsistente.');
  return { total: assertions, passed: assertions, failed: 0, skipped: 0 };
}

export function validatePlaywrightReport(report, expectedFiles) {
  const stats = report?.stats;
  if (
    !Array.isArray(expectedFiles) ||
    !expectedFiles.length ||
    !Number.isSafeInteger(stats?.expected) ||
    stats.expected <= 0 ||
    stats.unexpected !== 0 ||
    stats.flaky !== 0 ||
    stats.skipped !== 0 ||
    report.errors?.length ||
    !Array.isArray(report.suites)
  )
    throw new Error('Recorrido de navegador vacío, omitido, inestable o fallido.');
  const files = new Set();
  let total = 0;
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      if (!expectedFiles.includes(spec.file) || !spec.tests?.length || !spec.ok) {
        throw new Error('Especificación de navegador incompleta o inesperada.');
      }
      files.add(spec.file);
      for (const test of spec.tests) {
        if (
          test.expectedStatus !== 'passed' ||
          test.results?.length !== 1 ||
          test.results[0].status !== 'passed'
        ) {
          throw new Error('El recorrido contiene casos omitidos, repetidos o fallidos.');
        }
        total += 1;
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  if (total !== stats.expected || expectedFiles.some((file) => !files.has(file))) {
    throw new Error('Faltan archivos o casos en el recorrido de navegador.');
  }
  return { total, passed: total, failed: 0, skipped: 0 };
}
export function validateImageScan(report, scan, requiredTypes) {
  if (
    scan.status !== 0 ||
    scan.signal ||
    scan.error ||
    /unable to get vulnerability details|no vulnerability details|failed to get vulnerability/i.test(
      `${scan.stdout ?? ''}\n${scan.stderr ?? ''}`,
    )
  )
    throw new Error(
      'Escaneo de imagen fallido o inconcluso; no se acredita ausencia de vulnerabilidades.',
    );
  if (
    !/^sha256:[a-f0-9]{64}$/.test(report?.Metadata?.ImageID ?? '') ||
    !Array.isArray(report.Results) ||
    !requiredTypes.length ||
    requiredTypes.some(
      (type) =>
        !report.Results.some(
          (result) =>
            result.Type === type && Array.isArray(result.Packages) && result.Packages.length > 0,
        ),
    ) ||
    report.Results.some((result) =>
      result.Vulnerabilities?.some(
        (vulnerability) => !['LOW', 'MEDIUM'].includes(vulnerability.Severity),
      ),
    )
  )
    throw new Error('Inventario de imagen incompleto o vulnerabilidad no admitida.');
}
