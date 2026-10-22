import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  composeResetTarget,
  localDockerEndpoint,
  managedResetVolume,
  purposeLabel,
  resetArguments,
  resetPurpose,
  sameResetVolume,
  volumeConsumers,
} from '../../scripts/demo/reset-policy.mjs';

const project = 'nexo-reset-policy',
  target = { project, volumeName: `${project}_postgres18-data` };
const volume = () => ({
  Name: target.volumeName,
  Driver: 'local',
  Scope: 'local',
  Options: null,
  CreatedAt: '2026-01-01T00:00:00Z',
  Mountpoint: '/volumes/demo',
  Labels: {
    'com.docker.compose.project': project,
    'com.docker.compose.volume': 'postgres18-data',
    [purposeLabel]: resetPurpose,
  },
});
const config = () => ({
  name: project,
  services: {
    api: {
      image: 'nexo-api:local',
      environment: { DEMO_ENABLED: 'true', DB_NAME: 'nexo', DB_HOST: 'db' },
    },
    web: { image: 'nexo-web:local' },
    db: {
      image: 'nexo-db:local',
      environment: { POSTGRES_DB: 'nexo', PGDATA: '/var/lib/postgresql/18/docker' },
      volumes: [{ source: 'postgres18-data', type: 'volume', target: '/var/lib/postgresql' }],
    },
  },
  volumes: {
    'postgres18-data': { name: target.volumeName, labels: { [purposeLabel]: resetPurpose } },
  },
});
const container = () => ({
  Config: {
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.service': 'db',
      'com.docker.compose.project.working_dir': '/repo/infra',
    },
  },
  Mounts: [{ Type: 'volume', Name: target.volumeName, Destination: '/var/lib/postgresql' }],
});
test('reset requiere proyecto explícito y rechaza flags ambiguos o destinos arbitrarios', () => {
  assert.equal(resetArguments(['--project', project]).project, project);
  for (const args of [
    [],
    ['--project', 'other'],
    ['--project', project, '--force'],
    ['--project', project, '--project', project],
    ['--project', project, '--resume', 'x', '--evidence-dir', 'y'],
  ])
    assert.throws(() => resetArguments(args));
});
test('reset admite socket local y rechaza TCP, SSH y valores inválidos', () => {
  localDockerEndpoint('unix:///var/run/docker.sock');
  for (const value of [
    'tcp://localhost:2375',
    'ssh://local',
    'unix://host/socket',
    undefined,
    'unix:///a\nb',
  ])
    assert.throws(() => localDockerEndpoint(value));
});
test('solo proyecto demo reconocido con volumen nombrado administrado', () => {
  assert.deepEqual(composeResetTarget(config(), project), target);
  for (const mutate of [
    (c) => (c.services.api.environment.DEMO_ENABLED = 'false'),
    (c) => (c.volumes['postgres18-data'].external = true),
    (c) => (c.volumes['postgres18-data'].name = 'foreign'),
    (c) =>
      (c.volumes['postgres18-data'].driver_opts = { device: '/host', type: 'none', o: 'bind' }),
    (c) => (c.services.db.volumes[0].type = 'bind'),
    (c) => delete c.volumes['postgres18-data'].labels[purposeLabel],
    (c) => (c.services.extra = {}),
  ]) {
    const c = config();
    mutate(c);
    assert.throws(() => composeResetTarget(c, project));
  }
});
test('identidad exige etiqueta sintética, proyecto, driver local y fecha; no adopta volúmenes antiguos', () => {
  const identity = managedResetVolume(volume(), target);
  sameResetVolume(identity, identity);
  assert.throws(() =>
    sameResetVolume(identity, { ...identity, createdAt: '2026-01-02T00:00:00Z' }),
  );
  for (const mutate of [
    (v) => (v.Driver = 'other'),
    (v) => (v.Options = { device: '/host' }),
    (v) => delete v.Labels[purposeLabel],
    (v) => (v.Labels['com.docker.compose.project'] = 'foreign'),
    (v) => (v.CreatedAt = 'invalid'),
  ]) {
    const v = volume();
    mutate(v);
    assert.throws(() => managedResetVolume(v, target));
  }
});
test('consumidores extranjeros, binds superpuestos, oneoff y otro working_dir bloquean borrado', () => {
  assert.equal(volumeConsumers([container()], volume(), target, '/repo/infra').length, 1);
  for (const mutate of [
    (c) => (c.Config.Labels['com.docker.compose.project'] = 'foreign'),
    (c) => (c.Config.Labels['com.docker.compose.oneoff'] = 'True'),
    (c) => (c.Config.Labels['com.docker.compose.project.working_dir'] = '/other'),
    (c) => (c.Mounts = [{ Type: 'bind', Source: '/volumes', Destination: '/held' }]),
  ]) {
    const c = container();
    mutate(c);
    assert.throws(() => volumeConsumers([c], volume(), target, '/repo/infra'));
  }
  assert.throws(() => volumeConsumers([container(), container()], volume(), target, '/repo/infra'));
});
