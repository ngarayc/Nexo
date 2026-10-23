import { requiredJobs } from './policy.mjs';

export const fullCondition =
  "${{ github.ref == 'refs/heads/development' && (github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.profile == 'full')) }}";
export const expandedCondition =
  "${{ github.event_name == 'workflow_dispatch' && inputs.profile == 'expanded' && github.ref == 'refs/heads/development' }}";
export const promotionCondition =
  "${{ github.event_name == 'pull_request' || (github.event_name == 'push' && github.ref != 'refs/heads/development') }}";
export const gateCondition =
  "${{ always() && !(github.event_name == 'workflow_dispatch' && inputs.profile == 'expanded' && github.ref == 'refs/heads/development') }}";
const condition = (actual, expected) =>
  typeof actual === 'string' && actual.replaceAll(/\s/g, '') === expected.replaceAll(/\s/g, '');
const pin = /@[0-9a-f]{40}$/;
const same = (a, b) => Array.isArray(a) && [...a].sort().join(',') === [...b].sort().join(',');
const readOnly = (permissions) =>
  permissions &&
  typeof permissions === 'object' &&
  Object.values(permissions).every((value) => ['read', 'none'].includes(value));

function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('Pasos de CI ausentes.');
  for (const step of steps) {
    if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== false)
      throw new Error('No se permite ocultar errores de pasos.');
    if (step.uses && !step.uses.startsWith('./.github/actions/') && !pin.test(step.uses))
      throw new Error('Action externa sin SHA fijado.');
  }
}

function checkPublicationStep(job, scope) {
  const upload = job.steps.at(-1);
  const proof = job.steps.at(-2);
  if (
    !upload?.uses?.startsWith('actions/upload-artifact@') ||
    proof?.run !== `node scripts/ci/check-publication.mjs ${scope}` ||
    proof.if !== undefined ||
    proof['continue-on-error'] ||
    proof.env !== undefined
  )
    throw new Error('Falta la comprobación de publicación inmediatamente antes del upload.');
}

export function validateWorkflows(ci, review, setup, expanded) {
  if (
    !readOnly(ci.permissions) ||
    !readOnly(review.permissions) ||
    ci.permissions.actions !== 'read'
  )
    throw new Error('Permisos de workflow no limitados a lectura.');
  if (
    !same(Object.keys(ci.on ?? {}), ['push', 'pull_request', 'workflow_dispatch']) ||
    !same(ci.on.push?.branches, ['development', 'test', 'main']) ||
    !same(ci.on.pull_request?.branches, ['test', 'main']) ||
    Object.keys(ci.on.push).some((key) => key !== 'branches') ||
    Object.keys(ci.on.pull_request).some((key) => key !== 'branches')
  )
    throw new Error('Disparadores de CI incompletos o filtrados.');
  const profile = ci.on.workflow_dispatch?.inputs?.profile;
  if (
    !profile ||
    profile.required !== true ||
    profile.type !== 'choice' ||
    profile.default !== 'full' ||
    !same(profile.options, ['full', 'expanded']) ||
    !same(Object.keys(ci.on.workflow_dispatch.inputs), ['profile'])
  )
    throw new Error('Perfiles de ejecución ausentes o alterados.');
  if (!same(Object.keys(ci.jobs ?? {}), [...requiredJobs, 'ci-required', 'expanded']))
    throw new Error('Jobs obligatorios ausentes o contextos adicionales inesperados.');
  for (const [name, job] of Object.entries(ci.jobs)) {
    if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false)
      throw new Error('No se permite ocultar errores de jobs.');
    if (job.permissions && !readOnly(job.permissions))
      throw new Error('Un job solicita permisos de escritura.');
    if (name === 'expanded') {
      if (
        !condition(job.if, expandedCondition) ||
        job.uses !== './.github/workflows/expanded.yml' ||
        job.with?.source !== '${{ github.sha }}' ||
        job.with?.stage !== 'final' ||
        job.secrets !== undefined ||
        job.steps !== undefined
      )
        throw new Error('Invocación ampliada no fijada al candidato de development.');
      continue;
    }
    checkSteps(job.steps);
    if (name === 'ci-required') {
      if (!condition(job.if, gateCondition) || !same(job.needs, requiredJobs))
        throw new Error('El agregado debe evaluar siempre los cinco controles.');
      const uploads = job.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
      const upload = uploads[0];
      const proof = job.steps.at(-2);
      if (
        uploads.length !== 1 ||
        job.steps.at(-1) !== upload ||
        upload.with?.path !== 'reports/promotion/manifest.json' ||
        upload.with?.['if-no-files-found'] !== 'error' ||
        upload.with?.['retention-days'] !== 7 ||
        !condition(upload.if, promotionCondition) ||
        proof?.run !== 'node scripts/ci/check-publication.mjs promotion' ||
        !condition(proof.if, promotionCondition) ||
        proof.env !== undefined
      )
        throw new Error('La promoción publica solo su manifiesto comprobado.');
      const downloads = job.steps.filter((step) =>
        step.uses?.startsWith('actions/download-artifact@'),
      );
      if (
        downloads.length !== requiredJobs.length ||
        requiredJobs.some(
          (name) =>
            downloads.filter(
              (step) =>
                step.with?.name === `ci-${name}-\${{ github.run_id }}-\${{ github.run_attempt }}` &&
                step.with.path === 'reports/ci' &&
                condition(step.if, "${{ needs.quality.result == 'success' }}"),
            ).length !== 1,
        )
      )
        throw new Error('Descarga ordinaria incompleta o habilitada para promociones.');
      if (
        job.steps.some((step) => step.uses === './.github/actions/setup-project') ||
        job.steps.filter(
          (step) =>
            step.run === 'node scripts/ci/gate.mjs' && condition(step.if, '${{ always() }}'),
        ).length !== 1 ||
        job.steps[0].with?.['fetch-depth'] !== 0
      )
        throw new Error('Agregado sin verificación efectiva o preparación innecesaria.');
    } else {
      if (name === 'quality' ? !condition(job.if, fullCondition) : job.if !== undefined)
        throw new Error('La ruta completa debe ejecutar sus cinco controles sin omisiones.');
      if (name !== 'quality' && job.needs !== 'quality')
        throw new Error('Quality debe preceder a los otros controles.');
      const uploads = job.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
      if (
        uploads.length !== 1 ||
        uploads[0].with?.path !== `reports/ci/${name}.json` ||
        uploads[0].with?.['if-no-files-found'] !== 'error' ||
        uploads[0].with?.['retention-days'] !== 7
      )
        throw new Error('La lista de artefactos publicables se alteró.');
      checkPublicationStep(job, name);
    }
  }
  // El contexto de revisión jamás se emite como job omitido de un push a test.
  if (
    !same(Object.keys(review.on ?? {}), ['pull_request']) ||
    !same(review.on.pull_request?.branches, ['main']) ||
    Object.keys(review.on.pull_request).length !== 1 ||
    !same(Object.keys(review.jobs ?? {}), ['main-review'])
  )
    throw new Error('La revisión debe ser un workflow exclusivo de PR hacia main.');
  const human = review.jobs['main-review'];
  if (human.if !== undefined || human.environment !== 'main-review' || human['continue-on-error'])
    throw new Error('La revisión del candidato no puede omitirse.');
  if (human.permissions && !readOnly(human.permissions))
    throw new Error('La revisión no requiere escritura del token.');
  if (
    human.steps.some(
      (step) => step.if !== undefined || step.uses?.startsWith('actions/upload-artifact@'),
    ) ||
    setup.runs?.steps?.some((step) => step.uses?.startsWith('actions/upload-artifact@'))
  )
    throw new Error('Artefactos o condiciones inesperadas en revisión/preparación.');
  checkSteps(human.steps);
  checkSteps(setup.runs?.steps);
  validateExpandedWorkflow(expanded);
}

export function validateExpandedWorkflow(workflow) {
  if (
    !workflow ||
    !readOnly(workflow.permissions) ||
    !same(Object.keys(workflow.on ?? {}), ['workflow_dispatch', 'workflow_call']) ||
    !same(Object.keys(workflow.on.workflow_dispatch?.inputs ?? {}), ['source', 'stage']) ||
    !same(Object.keys(workflow.jobs ?? {}), ['expanded'])
  )
    throw new Error('Workflow ampliado ausente, disparador o permisos inválidos.');
  const called = workflow.on.workflow_call?.inputs;
  if (
    !called ||
    !same(Object.keys(called), ['source', 'stage']) ||
    Object.values(called).some((input) => input.required !== true || input.type !== 'string')
  )
    throw new Error('Contrato ampliado reutilizable inválido.');
  const inputs = workflow.on.workflow_dispatch.inputs;
  if (
    inputs.source.required !== true ||
    inputs.source.type !== 'string' ||
    inputs.stage.required !== true ||
    inputs.stage.type !== 'choice' ||
    !same(inputs.stage.options, ['rehearsal', 'final'])
  )
    throw new Error('Candidatura o etapa ampliada no explícita.');
  const job = workflow.jobs.expanded;
  if (
    job.if !== undefined ||
    job['continue-on-error'] ||
    (job.permissions && !readOnly(job.permissions)) ||
    job.env?.NEXO_CANDIDATE !== '${{ inputs.source }}' ||
    job.env?.NEXO_STAGE !== '${{ inputs.stage }}'
  )
    throw new Error('El recorrido ampliado no puede omitirse ni pedir escritura.');
  checkSteps(job.steps);
  if (
    job.steps.some((step) => step.if !== undefined) ||
    job.steps[0].run !== '[[ "$NEXO_CANDIDATE" =~ ^[0-9a-f]{40}$ ]]'
  )
    throw new Error('Falta validación de SHA previa o hay pasos condicionales.');
  const checkout = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
  if (
    checkout.length !== 1 ||
    checkout[0].with?.ref !== '${{ inputs.source }}' ||
    checkout[0].with?.['fetch-depth'] !== 0 ||
    checkout[0].with?.['persist-credentials'] !== false
  )
    throw new Error('Checkout ampliado no fijado a la candidatura.');
  if (
    !job.steps.some(
      (step) => step.run === 'node scripts/ci/run-expanded.mjs "$NEXO_CANDIDATE" "$NEXO_STAGE"',
    )
  )
    throw new Error('El recorrido ampliado no recibe el candidato explícito.');
  const uploads = job.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
  if (
    uploads.length !== 1 ||
    uploads[0].with?.path !== 'reports/expanded/manifest.json' ||
    uploads[0].with?.['if-no-files-found'] !== 'error' ||
    uploads[0].with?.['retention-days'] !== 7
  )
    throw new Error('Solo se publica el manifiesto ampliado validado.');
  checkPublicationStep(job, 'expanded');
}
