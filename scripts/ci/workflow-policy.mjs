import { requiredJobs } from './policy.mjs';

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
  if (!readOnly(ci.permissions) || !readOnly(review.permissions))
    throw new Error('Permisos de workflow no limitados a lectura.');
  if (
    !same(Object.keys(ci.on ?? {}), ['push', 'pull_request', 'workflow_dispatch']) ||
    !same(ci.on.push?.branches, ['development', 'test', 'main']) ||
    !same(ci.on.pull_request?.branches, ['test', 'main']) ||
    Object.keys(ci.on.push).some((key) => key !== 'branches') ||
    Object.keys(ci.on.pull_request).some((key) => key !== 'branches')
  )
    throw new Error('Disparadores de CI incompletos o filtrados.');
  if (!same(Object.keys(ci.jobs ?? {}), [...requiredJobs, 'ci-required']))
    throw new Error('Jobs obligatorios ausentes o contextos adicionales inesperados.');
  for (const [name, job] of Object.entries(ci.jobs)) {
    if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false)
      throw new Error('No se permite ocultar errores de jobs.');
    if (job.permissions && !readOnly(job.permissions))
      throw new Error('Un job solicita permisos de escritura.');
    checkSteps(job.steps);
    if (name === 'ci-required') {
      if (
        String(job.if).replaceAll(/\s/g, '') !== '${{always()}}' ||
        !same(job.needs, requiredJobs)
      )
        throw new Error('El agregado debe evaluar siempre los cinco controles.');
      if (job.steps.some((step) => step.uses?.startsWith('actions/upload-artifact@')))
        throw new Error('El agregado no publica artefactos adicionales.');
    } else {
      if (job.if !== undefined)
        throw new Error('Un control obligatorio no puede omitirse por condición.');
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
    !same(Object.keys(workflow.on ?? {}), ['workflow_dispatch']) ||
    !same(Object.keys(workflow.on.workflow_dispatch?.inputs ?? {}), ['source', 'stage']) ||
    !same(Object.keys(workflow.jobs ?? {}), ['expanded'])
  )
    throw new Error('Workflow ampliado ausente, disparador o permisos inválidos.');
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
