import { execFileSync } from 'node:child_process';
import { systemApiScript, systemStackIdentity } from './system-runtime.mjs';

export function resetSystemDemo() {
  const { project, envFile } = systemStackIdentity();
  try {
    execFileSync(
      process.execPath,
      ['scripts/demo/reset.mjs', '--project', project, '--env-file', envFile],
      {
        timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    throw new Error('El reset local del stack sintético de sistema no quedó preparado.');
  }
}

export function replayProof() {
  return JSON.parse(
    systemApiScript(`
    import { Pool } from 'pg';
    import { createHash } from 'node:crypto';
    import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
    const db=new Pool(readDatabaseConfig(process.env,true).pool),client=await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL transaction_timeout='10s'");
      const receipts=(await client.query('SELECT ingestion_id,state FROM ingestion_batches ORDER BY ingestion_id')).rows;
      const attempts=(await client.query('SELECT run_id,line_number,batch_index,ingestion_id,state,outcome,reason_code,http_status FROM replay_attempts ORDER BY run_id,line_number')).rows;
      const runs=(await client.query('SELECT run_id,scenario_id,stage,state,verification,verification_document::text AS report,scenario_verification FROM replay_runs ORDER BY created_at,run_id')).rows.map(({report,...row})=>({...row,reportFingerprint:report===null?null:createHash('sha256').update(report).digest('hex')}));
      const hash=createHash('sha256');
      for(const [table,key] of [['telemetry_events','event_pk'],['vehicle_latest','vehicle_pk'],['alerts','event_pk'],['outbox_messages','message_id']]) {
        hash.update(table+'\\n');
        for(const {row} of (await client.query('SELECT row_to_json(t)::text AS row FROM '+table+' t ORDER BY '+key)).rows)hash.update(row+'\\n');
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({receipts,attempts,runs,domainFingerprint:hash.digest('hex')}));
    }catch{process.stderr.write('Evidencia del par no comprobable.');process.exitCode=1;}
    finally{client.release();await db.end();}
  `),
  );
}

export function healthStatus() {
  return Number(
    systemApiScript(
      `try { const r=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)}); console.log(r.status); } catch { process.stderr.write('Salud no comprobable.'); process.exitCode=1; }`,
    ),
  );
}

export function blockOutboxMark(enabled) {
  const statement = enabled
    ? `
    CREATE FUNCTION public.nexo_i05_block_marker() RETURNS trigger LANGUAGE plpgsql AS $test$
    BEGIN RAISE EXCEPTION 'synthetic publication failure'; RETURN NEW; END $test$;
    CREATE TRIGGER nexo_i05_block_marker BEFORE UPDATE OF published_at ON public.outbox_messages
    FOR EACH ROW WHEN (NEW.published_at IS NOT NULL) EXECUTE FUNCTION public.nexo_i05_block_marker();
  `
    : `DROP TRIGGER IF EXISTS nexo_i05_block_marker ON public.outbox_messages; DROP FUNCTION IF EXISTS public.nexo_i05_block_marker();`;
  return JSON.parse(
    systemApiScript(`
    import { Pool } from 'pg';
    import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
    const db=new Pool(readDatabaseConfig(process.env,true).pool);
    try { await db.query(${JSON.stringify(statement)}); console.log('{"ok":true}'); }
    catch { process.stderr.write('Fallo SQL sintético no preparado/restaurado.'); process.exitCode=1; }
    finally { await db.end(); }
  `),
  );
}

export function domainCounts() {
  return JSON.parse(
    systemApiScript(`
    import { Pool } from 'pg';
    import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
    const db = new Pool(readDatabaseConfig(process.env, true).pool);
    try {
      const result = await db.query('SELECT (SELECT count(*)::int FROM telemetry_events) AS events, (SELECT count(*)::int FROM vehicle_latest) AS vehicles, (SELECT count(*)::int FROM alerts) AS alerts, (SELECT count(*)::int FROM outbox_messages) AS messages, (SELECT count(*)::int FROM outbox_messages WHERE published_at IS NULL) AS pending');
      console.log(JSON.stringify(result.rows[0]));
    } catch { process.stderr.write('Conteos sintéticos no comprobables.'); process.exitCode=1; }
    finally { await db.end(); }
  `),
  );
}
