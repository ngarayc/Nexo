export function validateCompose(config) {
  const services = config.services;
  if (!services || Object.keys(services).sort().join(',') !== 'api,db,web')
    throw new Error('Se requieren únicamente web, api y db.');
  for (const [name, service] of Object.entries(services)) {
    if (
      service.privileged ||
      service.network_mode ||
      service.pid ||
      service.devices?.length ||
      !service.security_opt?.includes('no-new-privileges:true')
    )
      throw new Error('Privilegios de contenedor incompatibles.');
    if (name !== 'web' && service.ports?.length) throw new Error('API y base no publican puertos.');
    if (
      name !== 'db' &&
      (!service.read_only || !service.cap_drop?.includes('ALL') || service.volumes?.length)
    )
      throw new Error(
        'La aplicación requiere filesystem de solo lectura y sin montajes persistentes/host.',
      );
  }
  const ports = services.web.ports;
  if (
    ports?.length !== 1 ||
    ports[0].host_ip !== '127.0.0.1' ||
    String(ports[0].published) !== '8080' ||
    ports[0].target !== 8080 ||
    ports[0].protocol !== 'tcp'
  )
    throw new Error('La aplicación debe publicar únicamente loopback 8080.');
  if (services.web.environment && Object.keys(services.web.environment).length)
    throw new Error('La web no recibe secretos de entorno.');
  const mounts = services.db.volumes;
  if (
    mounts?.length !== 2 ||
    !mounts.some((mount) => mount.type === 'volume' && mount.target === '/var/lib/postgresql') ||
    !mounts.some(
      (mount) =>
        mount.type === 'bind' &&
        mount.target === '/docker-entrypoint-initdb.d/01-nexo.sh' &&
        mount.read_only,
    )
  )
    throw new Error('Montajes de PostgreSQL incompatibles.');
  if (
    config.networks?.database?.internal !== true ||
    Object.keys(services.db.networks ?? {}).join(',') !== 'database'
  )
    throw new Error('La base requiere red interna de datos.');
}
