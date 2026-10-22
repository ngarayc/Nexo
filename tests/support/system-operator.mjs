import { systemApiScript } from './system-runtime.mjs';

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
