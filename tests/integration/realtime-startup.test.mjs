import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testStack } from '../support/stack.mjs';

test(
  'arranque con publicación degradada conserva proxy, ingesta y diagnóstico; salud solo recupera al resolverla',
  { timeout: 180000 },
  async () => {
    const stack = testStack({ publishWeb: false });
    try {
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      stack.compose('stop', 'web', 'api');
      stack.sql(`CREATE FUNCTION nexo_test_startup_publish_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-startup-publish-failure'; END $$;
      CREATE TRIGGER nexo_test_startup_publish_failure BEFORE UPDATE OF published_at ON outbox_messages FOR EACH ROW WHEN (NEW.published_at IS NOT NULL) EXECUTE FUNCTION nexo_test_startup_publish_failure()`);
      assert.equal(
        stack.apiTool(`
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import { Pool } from 'pg';
      import { drizzle } from 'drizzle-orm/node-postgres';
      import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
      import { ClassifyTelemetry } from '/app/apps/api/dist/modules/telemetry/application/classify.js';
      import { TelemetryTransaction } from '/app/apps/api/dist/modules/telemetry/adapters/postgres/telemetry-transaction.js';
      import { OriginalJson } from '/app/apps/api/dist/modules/telemetry/domain/original-json.js';
      const pool=new Pool(readDatabaseConfig(process.env).pool);
      try {
        const input=OriginalJson.parse(JSON.stringify({eventId:randomUUID(),vehicleId:randomUUID(),observedAt:'2026-01-01T00:00:00Z',latitude:4,longitude:-74,speedKph:81,ignitionOn:true}));
        const result=await drizzle(pool).transaction(tx=>new ClassifyTelemetry().execute(input,new TelemetryTransaction(tx)));
        assert.equal(result.outcome,'accepted');console.log('startup-seed-ok');
      } finally {await pool.end();}
    `),
        'startup-seed-ok',
      );
      // Sin --wait: los contenedores deben iniciar y seguir declarando salud
      // degradada. No se cambia el probe ni se lo sustituye por otro más débil.
      try {
        stack.compose('up', '-d', '--no-build', 'db', 'api', 'web');
      } catch {
        throw new Error('El proxy no inicia mientras el dispatcher está degradado.');
      }
      assert.equal(
        stack.apiScript(`
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      import http from 'node:http';
      import { setTimeout as pause } from 'node:timers/promises';
      const request=(path,body)=>new Promise((resolve,reject)=>{
        const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
        const call=http.request({hostname:'web',port:8080,path,method:bytes?'POST':'GET',signal:globalThis.AbortSignal.timeout(90000),headers:{Host:'localhost',Connection:'close',...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length,'X-API-Key':process.env.INGEST_API_KEY}:{})}},response=>{
          const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>{
            let data=null;try {data=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch { /* El proxy puede responder 502 durante el arranque. */ }
            resolve({status:response.statusCode,body:data});
          });
        });call.on('error',reject);call.end(bytes);
      });
      let degraded=false;
      const deadline=Date.now()+30000;
      do {
        try {const result=await request('/api/health');if(result.status===503&&result.body?.status==='unavailable'){degraded=true;break;}} catch { /* El servidor todavía no escucha. */ }
        await pause(100);
      } while(Date.now()<deadline);
      assert.equal(degraded,true,'El diagnóstico HTTP debe ser accesible y declarar la degradación.');
      const result=await request('/api/events/batch',{events:[{eventId:randomUUID(),vehicleId:randomUUID(),observedAt:'2026-01-01T00:00:00Z',latitude:4,longitude:-74,speedKph:81,ignitionOn:true}]});
      assert.equal(result.status,200);assert.equal(result.body.accepted,1);assert.equal(result.body.complete,true);
      assert.equal((await request('/api/health')).status,503);console.log('startup-degraded-ok');
    `),
        'startup-degraded-ok',
      );
      stack.sql(
        'DROP TRIGGER nexo_test_startup_publish_failure ON outbox_messages; DROP FUNCTION nexo_test_startup_publish_failure()',
      );
      await stack.waitHealthy();
      stack.compose('up', '-d', '--no-build', '--wait', 'db', 'api', 'web');
      assert.equal(stack.health().status, 200);
      assert.equal(stack.sql('SELECT count(*) FROM telemetry_events'), '2');
      assert.equal(
        stack.sql('SELECT count(*) FROM outbox_messages WHERE published_at IS NULL'),
        '0',
      );
      assert.equal(
        stack.sql('SELECT count(*) FROM outbox_messages WHERE published_at IS NOT NULL'),
        '6',
      );
    } finally {
      stack.close();
    }
  },
);
