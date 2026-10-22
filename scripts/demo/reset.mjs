import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DockerReset, repository } from './reset-docker.mjs';
import {
  acquireLock,
  evidenceRoot,
  exportEvidence,
  fingerprint,
  newOperation,
  privateFile,
  readManifest,
  resumeDirectory,
  saveManifest,
  verifyArchive,
} from './reset-evidence.mjs';
import {
  ResetError,
  composeResetTarget,
  managedResetVolume,
  resetArguments,
  sameResetVolume,
  volumeConsumers,
} from './reset-policy.mjs';

export function resetDemo(args, { Adapter = DockerReset, announce = console.log } = {}) {
  const options = resetArguments(args),
    envFile = privateFile(resolve(repository, options.envFile));
  const adapter = new Adapter(options.project, envFile),
    engine = adapter.environment(),
    target = composeResetTarget(adapter.config(), options.project);
  const context = {
    engine,
    project: target.project,
    volumeName: target.volumeName,
    envFingerprint: fingerprint(readFileSync(envFile)),
  };
  const inspect = () => {
    const volume = adapter.volume(target.volumeName);
    if (!volume)
      return {
        volume: null,
        identity: null,
        containers: volumeConsumers(adapter.containers(), {}, target, repository + '/infra'),
      };
    const identity = managedResetVolume(volume, target),
      containers = volumeConsumers(adapter.containers(), volume, target, repository + '/infra');
    return { volume, identity, containers };
  };
  let current = inspect(),
    images = adapter.images(current.containers);
  announce(
    `Destino local: ${target.project}; volumen: ${target.volumeName}. Se descartará su base sintética; los informes se conservan en reports/.`,
  );
  if (options.inspect)
    return {
      inspected: true,
      project: target.project,
      volume: target.volumeName,
      exists: current.volume !== null,
    };
  let directory, manifest;
  if (options.resume) {
    directory = resumeDirectory(options.resume, repository);
    manifest = readManifest(directory);
    if (
      Object.entries(context).some(([key, value]) => manifest[key] !== value) ||
      JSON.stringify(manifest.images) !== JSON.stringify(images)
    )
      throw new ResetError('RESUME_TARGET_CHANGED');
  } else {
    if (!current.identity) throw new ResetError('VOLUME_REQUIRED');
    const operation = newOperation(
      evidenceRoot(resolve(repository, options.evidenceDir), repository),
      target.project,
    );
    directory = operation.directory;
    manifest = {
      version: 1,
      id: operation.id,
      ...context,
      images,
      oldVolume: current.identity,
      phase: 'created',
      archives: [],
    };
  }
  const unlock = acquireLock(
    repository,
    target.project,
    engine,
    manifest.id,
    Boolean(options.resume),
  );
  const save = (phase) => {
    manifest.phase = phase;
    saveManifest(directory, manifest);
  };
  const validateArchives = () => {
    for (const archive of manifest.archives) verifyArchive(directory, archive);
  };
  const snapshot = () => {
    manifest.archives.push(exportEvidence(adapter, directory));
    saveManifest(directory, manifest);
  };
  announce(`Evidencia y reanudación: ${directory.replace(repository + '/', '')}`);
  try {
    saveManifest(directory, manifest);
    validateArchives();
    if (manifest.phase === 'complete') {
      if (!current.identity || !manifest.newVolume) throw new ResetError('VOLUME_CHANGED');
      sameResetVolume(current.identity, manifest.newVolume);
      const observed = exportEvidence(adapter, directory);
      manifest.archives.push(observed);
      saveManifest(directory, manifest);
      if (Object.values(observed.counts).some((value) => value !== '0'))
        throw new ResetError('NOT_EMPTY');
      const prepared = adapter.verify();
      if (prepared.ready !== true) throw new ResetError('NOT_PREPARED');
      return { complete: true, resumed: true, directory, prepared };
    }
    const afterRemoval = ['removing', 'removed', 'recreating', 'verifying'].includes(
      manifest.phase,
    );
    if (current.identity?.createdAt === manifest.oldVolume.createdAt) {
      sameResetVolume(current.identity, manifest.oldVolume);
      // Captura inicial y otra tras cerrar emisor/entrada/consumidores.
      if (
        !current.containers.some(
          (c) => c.Config.Labels['com.docker.compose.service'] === 'db' && c.State?.Running,
        )
      )
        adapter.compose('up', '-d', '--no-build', '--wait', 'db');
      snapshot();
      save('archived');
      adapter.stopApplication();
      current = inspect();
      sameResetVolume(current.identity ?? {}, manifest.oldVolume);
      if (
        current.containers.some(
          (c) => c.Config.Labels['com.docker.compose.service'] !== 'db' && c.State?.Running,
        )
      )
        throw new ResetError('SERVICES_RUNNING');
      snapshot();
      validateArchives();
      adapter.stopDatabase();
      current = inspect();
      sameResetVolume(current.identity ?? {}, manifest.oldVolume);
      if (current.containers.some((c) => c.State?.Running))
        throw new ResetError('SERVICES_RUNNING');
      save('stopped');
      adapter.down();
      current = inspect();
      sameResetVolume(current.identity ?? {}, manifest.oldVolume);
      if (
        current.containers.length ||
        adapter.containers().some((c) => c.Mounts?.some((m) => m.Name === target.volumeName))
      )
        throw new ResetError('VOLUME_IN_USE');
      validateArchives();
      save('removing');
      adapter.removeVolume(target.volumeName);
      save('removed');
    } else if (!afterRemoval) throw new ResetError('VOLUME_CHANGED');
    else if (!manifest.archives.length) throw new ResetError('INCOMPLETE_EVIDENCE');
    // Después del borrado nunca se borra un volumen de reemplazo en --resume.
    validateArchives();
    save('recreating');
    adapter.up();
    current = inspect();
    if (!current.identity || current.identity.createdAt === manifest.oldVolume.createdAt)
      throw new ResetError('VOLUME_NOT_REPLACED');
    if (manifest.newVolume) sameResetVolume(current.identity, manifest.newVolume);
    manifest.newVolume = current.identity;
    save('verifying');
    const empty = exportEvidence(adapter, directory);
    manifest.archives.push(empty);
    saveManifest(directory, manifest);
    if (
      Object.values(empty.counts).some((value) => value !== '0') ||
      empty.accountReady !== true ||
      !empty.migrationHash
    )
      throw new ResetError('NOT_EMPTY');
    const prepared = adapter.verify();
    if (prepared.ready !== true) throw new ResetError('NOT_PREPARED');
    manifest.prepared = prepared;
    save('complete');
    announce(
      'Base sintética recreada y vacía, cuenta demo y salud comprobadas; reproductor detenido.',
    );
    return { complete: true, directory, prepared };
  } finally {
    unlock();
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    resetDemo(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Reset no completado: ${error instanceof ResetError ? error.code : 'LOCAL_OPERATION_FAILED'}. Conserve reports/ y use --resume con el mismo destino; no se declara preparado.`,
    );
    process.exitCode = 1;
  }
}
