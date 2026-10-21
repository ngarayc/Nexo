import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompose } from './compose-policy.mjs';

const valid = () => ({
  services: {
    api: { read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] },
    web: {
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      ports: [{ host_ip: '127.0.0.1', published: '8080', target: 8080, protocol: 'tcp' }],
    },
    db: {
      security_opt: ['no-new-privileges:true'],
      networks: { database: null },
      volumes: [
        { type: 'volume', target: '/var/lib/postgresql' },
        { type: 'bind', target: '/docker-entrypoint-initdb.d/01-nexo.sh', read_only: true },
      ],
    },
  },
  networks: { database: { internal: true } },
});

test('admite la composición de tres servicios y persistencia privada', () =>
  validateCompose(valid()));
test('bloquea exposición pública y puertos directos de backend/base', () => {
  for (const mutate of [
    (c) => {
      c.services.web.ports[0].host_ip = '0.0.0.0';
    },
    (c) => {
      c.services.api.ports = [{ published: '3000' }];
    },
    (c) => {
      c.services.db.ports = [{ published: '5432' }];
    },
  ]) {
    const config = valid();
    mutate(config);
    assert.throws(() => validateCompose(config));
  }
});
test('bloquea privilegios, montajes de host y secretos en web', () => {
  for (const mutate of [
    (c) => {
      c.services.api.privileged = true;
    },
    (c) => {
      c.services.api.volumes = [{ source: '/var/run/docker.sock' }];
    },
    (c) => {
      c.services.web.environment = { INGEST_API_KEY: 'marcador' };
    },
    (c) => {
      c.networks.database.internal = false;
    },
  ]) {
    const config = valid();
    mutate(config);
    assert.throws(() => validateCompose(config));
  }
});
