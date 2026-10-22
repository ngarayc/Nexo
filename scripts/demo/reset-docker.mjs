import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ResetError, localDockerEndpoint } from './reset-policy.mjs';

const databaseSource = readFileSync(new URL('./reset-database.mjs', import.meta.url), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
export const repository = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
export class DockerReset {
  constructor(project, envFile) {
    this.project = project;
    this.options = [
      'compose',
      '--project-name',
      project,
      '--env-file',
      envFile,
      '-f',
      'infra/compose.yaml',
    ];
  }
  execute(args, { input, output, timeout = 180000 } = {}) {
    try {
      return (
        execFileSync('docker', args, {
          cwd: repository,
          input,
          encoding: 'utf8',
          timeout,
          maxBuffer: 8 * 1024 * 1024,
          stdio: ['pipe', output ?? 'pipe', 'pipe'],
        })?.trim() ?? ''
      );
    } catch {
      throw new ResetError('DOCKER_OPERATION_FAILED');
    }
  }
  compose(...args) {
    return this.execute([...this.options, ...args]);
  }
  json(...args) {
    try {
      return JSON.parse(this.execute(args));
    } catch {
      throw new ResetError('DOCKER_INSPECTION_FAILED');
    }
  }
  environment() {
    if (process.env.DOCKER_HOST) localDockerEndpoint(process.env.DOCKER_HOST);
    const context = this.json('context', 'inspect')[0];
    localDockerEndpoint(context?.Endpoints?.docker?.Host);
    const info = this.json('info', '--format', '{{json .}}');
    if (typeof info.ID !== 'string' || !info.ID || info.OSType !== 'linux')
      throw new ResetError('DOCKER_NOT_LOCAL');
    return hash(info.ID);
  }
  config() {
    try {
      return JSON.parse(this.compose('config', '--format', 'json'));
    } catch {
      throw new ResetError('INVALID_COMPOSE');
    }
  }
  volume(name) {
    // Distinguir ausencia confirmada de fallo de inspect/daemon.
    const names = this.execute(['volume', 'ls', '--format', '{{.Name}}']).split('\n');
    return names.includes(name) ? this.json('volume', 'inspect', name)[0] : null;
  }
  containers() {
    const ids = this.execute(['ps', '-aq']).split(/\s+/).filter(Boolean);
    const result = [];
    for (let i = 0; i < ids.length; i += 100)
      result.push(...this.json('inspect', ...ids.slice(i, i + 100)));
    return result;
  }
  images(containers) {
    const result = {};
    for (const service of ['api', 'db', 'web']) {
      const id = this.json('image', 'inspect', `nexo-${service}:local`)[0]?.Id;
      if (
        typeof id !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(id) ||
        containers.some(
          (c) => c.Config.Labels['com.docker.compose.service'] === service && c.Image !== id,
        )
      )
        throw new ResetError('IMAGE_CHANGED');
      result[service] = id;
    }
    return result;
  }
  archive(fd) {
    this.execute(
      [
        ...this.options,
        'run',
        '--rm',
        '-T',
        '--no-deps',
        '--entrypoint',
        'node',
        'api',
        '--input-type=module',
      ],
      { input: databaseSource, output: fd, timeout: 45000 },
    );
  }
  stopApplication() {
    this.compose('stop', '--timeout', '15', 'web', 'api');
  }
  stopDatabase() {
    this.compose('stop', '--timeout', '15', 'db');
  }
  down() {
    this.compose('down', '--timeout', '15');
  }
  removeVolume(name) {
    this.execute(['volume', 'rm', name]);
  }
  up() {
    this.compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'db', 'api', 'web');
  }
  verify() {
    const text = this.compose(
      'exec',
      '-T',
      'api',
      'node',
      '--input-type=module',
      '-e',
      `
      const origin=process.env.PUBLIC_ORIGIN,base='http://127.0.0.1:3000/api';
      const get=(path,init={})=>fetch(base+path,{...init,signal:AbortSignal.timeout(6000)});
      try {
        if((await get('/health')).status!==200)throw 0;
        const login=await get('/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"username":"demo","password":"demo"}'});
        if(login.status!==200)throw 0;
        const cookie=login.headers.get('set-cookie')?.split(';')[0],csrf=(await login.json()).csrfToken;
        if(!cookie||typeof csrf!=='string')throw 0;
        const replay=await get('/demo/replay',{headers:{Cookie:cookie}});
        const control=await replay.json();
        if(replay.status!==200||control.run!==null||typeof control.instanceId!=='string')throw 0;
        const logout=await get('/session',{method:'DELETE',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf}});
        if(logout.status!==204)throw 0;
        const old=await get('/demo/replay',{headers:{Cookie:cookie}});
        if(old.status!==403)throw 0;
        console.log(JSON.stringify({ready:true,instanceId:control.instanceId}));
      }catch{process.exitCode=1;}
    `,
    );
    try {
      return JSON.parse(text);
    } catch {
      throw new ResetError('NOT_PREPARED');
    }
  }
}
