import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { testStack } from '../support/stack.mjs';
import { resetDemo } from '../../scripts/demo/reset.mjs';

test(
  'fuente limpia arranca, autentica, conserva datos al recrear y permite reset local propio',
  { timeout: 300000 },
  () => {
    const stack = testStack({ webPort: 8081 });
    const environment = stack.browserEnvironment();
    const login = () =>
      stack.apiScript(`
    const r=await fetch('http://127.0.0.1:3000/api/session',{method:'POST',headers:{Origin:process.env.PUBLIC_ORIGIN,'Content-Type':'application/json'},body:'{"username":"demo","password":"demo"}'});
    if(r.status!==200||!r.headers.get('set-cookie')||(await r.json()).csrfToken===undefined)throw Error('clean-login');
    console.log('clean-login-ok');
  `);
    const snapshot = () =>
      ['users', 'telemetry_events', 'vehicle_latest', 'alerts', 'outbox_messages'].map((table) =>
        stack.sql(
          `SELECT coalesce(json_agg(t ORDER BY to_jsonb(t)::text)::text,'[]') FROM ${table} t`,
        ),
      );
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      assert.equal(stack.health().status, 200);
      assert.equal(login(), 'clean-login-ok');
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '0');
      assert.equal(
        stack.apiScript(`
      const headers={'X-API-Key':process.env.INGEST_API_KEY,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()};
      let r=await fetch('http://127.0.0.1:3000/api/events/batch',{method:'POST',headers,body:JSON.stringify({events:[{eventId:'CLEAN-1',vehicleId:'CLEAN',observedAt:'2026-01-01T05:00:00Z',latitude:4,longitude:-74,speedKph:81,ignitionOn:true}]})});
      if(r.status===503){
        const pending=await r.json();if(pending.code!=='INGESTION_RESULT_PENDING'||pending.admission!=='admitted')throw Error('clean-admission');
        const deadline=Date.now()+60000;
        do{await new Promise(resolve=>setTimeout(resolve,250));r=await fetch('http://127.0.0.1:3000/api/ingestions/'+headers['Idempotency-Key'],{headers:{'X-API-Key':process.env.INGEST_API_KEY}});if(r.status!==200)throw Error('clean-poll');if((await r.clone().json()).complete)break;}while(Date.now()<deadline);
      }
      if(r.status!==200)throw Error('clean-ingest');
      const result=await r.json();
      if(!result.complete||result.accepted!==1||result.duplicates!==0||result.rejected!==0)throw Error('clean-receipt');
      console.log('clean-ingest-ok');
    `),
        'clean-ingest-ok',
      );
      // Esperar al marcado técnico de outbox antes de comparar su persistencia.
      assert.equal(
        stack.apiScript(`
      import { Pool } from 'pg';
      import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
      const pool=new Pool(readDatabaseConfig(process.env).pool);
      try {
        const deadline=Date.now()+15000;let complete=false;
        while(Date.now()<deadline){const r=await pool.query('SELECT count(*)::int AS pending FROM outbox_messages WHERE published_at IS NULL');if(r.rows[0].pending===0){complete=true;break;}await new Promise(r=>setTimeout(r,100));}
        if(!complete)throw Error('clean-outbox');console.log('clean-outbox-ok');
      } finally {await pool.end();}
    `),
        'clean-outbox-ok',
      );
      assert.equal(stack.sql('SELECT count(*) FROM alerts'), '1');
      const before = snapshot();
      stack.compose('down');
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      const after = snapshot();
      assert.equal(
        before.every((value, index) => value === after[index]),
        true,
        'Datos y credencial conservados sin publicar sus valores.',
      );
      assert.equal(stack.health().status, 200);
      assert.equal(login(), 'clean-login-ok');
      const result = resetDemo(
        [
          '--project',
          environment.NEXO_SYSTEM_PROJECT,
          '--env-file',
          environment.NEXO_SYSTEM_ENV_FILE,
          '--evidence-dir',
          join('reports', 'raw', 'expanded', 'clean-' + randomUUID()),
        ],
        { announce: () => {} },
      );
      assert.equal(result.complete, true);
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '0');
      assert.equal(stack.sql('SELECT count(*) FROM users'), '1');
      assert.equal(login(), 'clean-login-ok');
    } finally {
      stack.close();
    }
  },
);
