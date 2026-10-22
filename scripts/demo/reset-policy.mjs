export const purposeLabel = 'io.github.ngarayc.nexo.purpose';
export const resetPurpose = 'synthetic-demo';
const projectPattern = /^nexo(?:-[a-z0-9][a-z0-9-]{0,62})?$/;
export class ResetError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new ResetError(code);
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function resetArguments(args) {
  const allowed = new Set(['--project', '--env-file', '--evidence-dir', '--resume', '--inspect']);
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || values.has(key)) fail('INVALID_ARGUMENTS');
    if (key === '--inspect') {
      values.set(key, true);
      continue;
    }
    const value = args[++i];
    if (typeof value !== 'string' || !value.length || value.startsWith('--'))
      fail('INVALID_ARGUMENTS');
    values.set(key, value);
  }
  const project = values.get('--project');
  if (
    typeof project !== 'string' ||
    !projectPattern.test(project) ||
    (values.has('--resume') && values.has('--evidence-dir'))
  )
    fail('INVALID_ARGUMENTS');
  return {
    project,
    envFile: values.get('--env-file') ?? '.env.local',
    evidenceDir: values.get('--evidence-dir') ?? 'reports/demo-reset',
    resume: values.get('--resume'),
    inspect: values.has('--inspect'),
  };
}
export function localDockerEndpoint(host) {
  if (typeof host !== 'string' || !/^unix:\/\/\/[^\0\n\r]+$/.test(host)) fail('DOCKER_NOT_LOCAL');
}
export function composeResetTarget(config, project) {
  if (
    !projectPattern.test(project) ||
    !object(config) ||
    config.name !== project ||
    !object(config.services) ||
    Object.keys(config.services).sort().join(',') !== 'api,db,web' ||
    !object(config.volumes) ||
    Object.keys(config.volumes).join(',') !== 'postgres18-data'
  )
    fail('UNRECOGNIZED_PROJECT');
  const volume = config.volumes['postgres18-data'],
    api = config.services.api,
    db = config.services.db;
  if (
    !object(volume) ||
    volume.external ||
    volume.name !== `${project}_postgres18-data` ||
    (volume.driver && volume.driver !== 'local') ||
    Object.keys(volume.driver_opts ?? {}).length ||
    volume.labels?.[purposeLabel] !== resetPurpose
  )
    fail('UNRECOGNIZED_VOLUME');
  if (
    api.environment?.DEMO_ENABLED !== 'true' ||
    api.environment?.DB_NAME !== 'nexo' ||
    api.environment?.DB_HOST !== 'db' ||
    db.environment?.POSTGRES_DB !== 'nexo' ||
    db.environment?.PGDATA !== '/var/lib/postgresql/18/docker'
  )
    fail('DEMO_REQUIRED');
  if (
    api.image !== 'nexo-api:local' ||
    db.image !== 'nexo-db:local' ||
    config.services.web.image !== 'nexo-web:local'
  )
    fail('UNRECOGNIZED_PROJECT');
  const mounts = Object.entries(config.services).flatMap(([service, c]) =>
    (c.volumes ?? []).filter((v) => v.source === 'postgres18-data').map((v) => ({ service, ...v })),
  );
  if (
    mounts.length !== 1 ||
    mounts[0].service !== 'db' ||
    mounts[0].type !== 'volume' ||
    mounts[0].target !== '/var/lib/postgresql'
  )
    fail('UNRECOGNIZED_VOLUME');
  return Object.freeze({ project, volumeName: volume.name });
}
export function managedResetVolume(volume, target) {
  if (
    !object(volume) ||
    volume.Name !== target.volumeName ||
    volume.Driver !== 'local' ||
    volume.Scope !== 'local' ||
    Object.keys(volume.Options ?? {}).length ||
    volume.Labels?.['com.docker.compose.project'] !== target.project ||
    volume.Labels?.['com.docker.compose.volume'] !== 'postgres18-data' ||
    volume.Labels?.[purposeLabel] !== resetPurpose ||
    typeof volume.CreatedAt !== 'string' ||
    !Number.isFinite(Date.parse(volume.CreatedAt))
  )
    fail('UNRECOGNIZED_VOLUME');
  return { name: volume.Name, createdAt: volume.CreatedAt };
}
export function volumeConsumers(containers, volume, target, workingDirectory) {
  const owned = [];
  for (const c of containers) {
    const labels = c.Config?.Labels ?? {};
    const own = labels['com.docker.compose.project'] === target.project;
    const mounts = c.Mounts ?? [];
    const uses = mounts.some(
      (m) =>
        m.Name === target.volumeName ||
        (typeof m.Source === 'string' &&
          typeof volume.Mountpoint === 'string' &&
          (m.Source === volume.Mountpoint ||
            m.Source.startsWith(volume.Mountpoint + '/') ||
            volume.Mountpoint.startsWith(m.Source.replace(/\/$/, '') + '/'))),
    );
    if (
      uses &&
      (!own ||
        labels['com.docker.compose.service'] !== 'db' ||
        !mounts.some(
          (m) =>
            m.Type === 'volume' &&
            m.Name === target.volumeName &&
            m.Destination === '/var/lib/postgresql',
        ))
    )
      fail('VOLUME_SHARED');
    if (!own) continue;
    if (
      !['api', 'db', 'web'].includes(labels['com.docker.compose.service']) ||
      String(labels['com.docker.compose.oneoff']).toLowerCase() === 'true' ||
      labels['com.docker.compose.project.working_dir'] !== workingDirectory
    )
      fail('UNRECOGNIZED_PROJECT');
    owned.push(c);
  }
  if (
    new Set(owned.map((c) => c.Config.Labels['com.docker.compose.service'])).size !== owned.length
  )
    fail('UNRECOGNIZED_PROJECT');
  return owned;
}
export function sameResetVolume(actual, expected) {
  if (actual.name !== expected.name || actual.createdAt !== expected.createdAt)
    fail('VOLUME_CHANGED');
}
