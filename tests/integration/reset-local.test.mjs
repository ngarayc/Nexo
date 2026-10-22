import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { DockerReset, repository } from '../../scripts/demo/reset-docker.mjs';
import { ResetError } from '../../scripts/demo/reset-policy.mjs';
import { resetDemo } from '../../scripts/demo/reset.mjs';
import { testStack } from '../support/stack.mjs';

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
test(
  'reset real conserva informes, bloquea destinos/evidencia inválidos y reanuda pérdida tras borrado sin tocar volumen ajeno',
  { timeout: 300000 },
  () => {
    const stack = testStack({ webPort: 8081 }),
      env = stack.browserEnvironment();
    const project = env.NEXO_SYSTEM_PROJECT,
      base = ['--project', project, '--env-file', env.NEXO_SYSTEM_ENV_FILE];
    const root = join(repository, 'reports', `reset-test-${randomUUID()}`),
      sentinel = `nexo-reset-sentinel-${randomUUID()}`,
      holder = `nexo-reset-holder-${randomUUID()}`;
    const quiet = () => {};
    mkdirSync(root, { recursive: true, mode: 0o700 });
    docker('volume', 'create', sentinel);
    const foreignBefore = JSON.parse(docker('volume', 'inspect', sentinel))[0];
    let adapter;
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      adapter = new DockerReset(project, env.NEXO_SYSTEM_ENV_FILE);
      const target = `${project}_postgres18-data`,
        old = adapter.volume(target);
      const original = JSON.parse(
        stack.apiScript(`
      const base='http://127.0.0.1:3000/api',origin=process.env.PUBLIC_ORIGIN;
      const response=await fetch(base+'/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"username":"demo","password":"demo"}'});
      if(response.status!==200)throw new Error('reset-test-session');
      const cookie=response.headers.get('set-cookie').split(';')[0],csrf=(await response.json()).csrfToken;
      const view=await (await fetch(base+'/demo/replay',{headers:{Cookie:cookie}})).json();
      const command=await fetch(base+'/demo/replay/commands',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),instanceId:view.instanceId,expectedControlVersion:view.controlVersion,runId:null,action:'start',intervalMs:100})});
      if(command.status!==202)throw new Error('reset-test-start');
      const deadline=Date.now()+45000;
      let run;
      while(Date.now()<deadline){run=(await (await fetch(base+'/demo/replay',{headers:{Cookie:cookie}})).json()).run;if(run?.state==='completed'&&run.verification!=='pending')break;await new Promise(r=>setTimeout(r,250));}
      if(run?.verification!=='conformant')throw new Error('reset-test-report');
      console.log(JSON.stringify({cookie,instanceId:view.instanceId,runId:run.runId}));
    `),
      );
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '20');
      assert.throws(
        () =>
          resetDemo(['--project', 'unrelated', '--env-file', env.NEXO_SYSTEM_ENV_FILE], {
            announce: quiet,
          }),
        (e) => e.code === 'INVALID_ARGUMENTS',
      );
      docker(
        'create',
        '--name',
        holder,
        '--mount',
        `type=volume,source=${target},target=/held`,
        'nexo-db:local',
      );
      assert.throws(
        () => resetDemo([...base, '--inspect'], { announce: quiet }),
        (e) => e.code === 'VOLUME_SHARED',
      );
      docker('rm', holder);
      const obstruction = join(root, 'file');
      writeFileSync(obstruction, 'not a directory', { mode: 0o600 });
      assert.throws(() => resetDemo([...base, '--evidence-dir', obstruction], { announce: quiet }));
      assert.equal(adapter.volume(target).CreatedAt, old.CreatedAt);
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '20');
      class FailSecondArchive extends DockerReset {
        calls = 0;
        archive(fd) {
          if (++this.calls === 2) throw new ResetError('SYNTHETIC_EVIDENCE_FAILURE');
          super.archive(fd);
        }
      }
      const evidence = join(root, 'operation');
      assert.throws(
        () =>
          resetDemo([...base, '--evidence-dir', evidence], {
            Adapter: FailSecondArchive,
            announce: quiet,
          }),
        (e) => e.code === 'SYNTHETIC_EVIDENCE_FAILURE',
      );
      const directory = join(evidence, readdirSync(evidence)[0]),
        manifestPath = join(directory, 'manifest.json');
      const manifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest().phase, 'archived');
      assert.equal(manifest().archives.length, 1);
      const first = manifest().archives[0],
        raw = readFileSync(join(directory, first.name), 'utf8');
      assert.ok(raw.includes(original.runId));
      assert.ok(raw.includes('conformant'));
      assert.ok(
        !/password_hash|request_document|input_document|session_secret|ingest_api_key/i.test(raw),
      );
      assert.equal(adapter.volume(target).CreatedAt, old.CreatedAt);
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '20');
      class LoseRemovalResponse extends DockerReset {
        removeVolume(name) {
          super.removeVolume(name);
          throw new ResetError('SYNTHETIC_REMOVAL_RESPONSE_LOST');
        }
      }
      const resume = [...base, '--resume', directory];
      assert.throws(
        () => resetDemo(resume, { Adapter: LoseRemovalResponse, announce: quiet }),
        (e) => e.code === 'SYNTHETIC_REMOVAL_RESPONSE_LOST',
      );
      assert.equal(manifest().phase, 'removing');
      assert.equal(adapter.volume(target), null);
      const previousPort = process.env.WEB_PORT;
      try {
        process.env.WEB_PORT = '8080';
        assert.throws(
          () => resetDemo(resume, { announce: quiet }),
          (e) => e.code === 'RESUME_TARGET_CHANGED',
        );
      } finally {
        if (previousPort === undefined) delete process.env.WEB_PORT;
        else process.env.WEB_PORT = previousPort;
      }
      const result = resetDemo(resume, { announce: quiet });
      assert.equal(result.complete, true);
      assert.notEqual(result.prepared.instanceId, original.instanceId);
      assert.equal(manifest().phase, 'complete');
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '0');
      assert.equal(stack.sql('SELECT count(*) FROM replay_runs'), '0');
      assert.equal(readFileSync(join(directory, first.name), 'utf8'), raw);
      const oldSession = stack.apiScript(
        `const r=await fetch('http://127.0.0.1:3000/api/demo/replay',{headers:{Cookie:${JSON.stringify(original.cookie)}}});console.log(r.status);`,
      );
      assert.equal(oldSession, '403');
      const newVolume = adapter.volume(target);
      assert.equal(resetDemo(resume, { announce: quiet }).resumed, true);
      assert.equal(adapter.volume(target).CreatedAt, newVolume.CreatedAt);
      // Una reanudación ya completa no borra datos nuevos ni repite el reset.
      stack.sql(
        "INSERT INTO telemetry_events(event_key,vehicle_key,observed_at_original,observed_epoch_second,observed_fraction,latitude,longitude,speed_kph,ignition_on,payload_extra) VALUES(decode('00000041','hex'),decode('00000042','hex'),'2026-01-01T00:00:00Z',1767225600,'',0,0,0,false,'{}')",
      );
      assert.throws(
        () => resetDemo(resume, { announce: quiet }),
        (e) => e.code === 'NOT_EMPTY',
      );
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '1');
      assert.equal(adapter.volume(target).CreatedAt, newVolume.CreatedAt);
      assert.equal(
        JSON.parse(docker('volume', 'inspect', sentinel))[0].CreatedAt,
        foreignBefore.CreatedAt,
      );
      assert.ok(existsSync(manifestPath));
      console.log(
        `Reset focalizado: archivo/reanudación y volumen ajeno comprobados (${relative(repository, root).split('/')[0]}).`,
      );
    } finally {
      try {
        docker('rm', '-f', holder);
      } catch {
        /* Solo el contenedor de bloqueo creado por este caso. */
      }
      stack.close();
      docker('volume', 'rm', sentinel);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
