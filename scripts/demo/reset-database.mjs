// Se ejecuta por stdin en un contenedor efímero, sin arrancar el servidor.
// La lista de columnas excluye cuerpos admitidos, sesiones y credenciales.
import { Pool } from 'pg';
import { readDatabaseConfig } from '/app/apps/api/dist/platform/database/config.js';
const pool = new Pool(readDatabaseConfig(process.env, true).pool);
const tables = [
  'telemetry_events',
  'vehicle_latest',
  'alerts',
  'outbox_messages',
  'ingestion_batches',
  'ingestion_items',
  'replay_runs',
  'replay_attempts',
];
let bytes = 0;
function emit(kind, data) {
  const line = JSON.stringify({ kind, data }) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > 64 * 1024 * 1024) throw new Error('archive-limit');
  process.stdout.write(line);
}
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL transaction_timeout='30s'");
    const counts = {};
    for (const table of tables)
      counts[table] = (
        await client.query(`SELECT count(*)::text AS total FROM ${table}`)
      ).rows[0].total;
    emit('snapshot', {
      observedAt: (await client.query('SELECT transaction_timestamp() AS at')).rows[0].at,
      counts,
      migrationHash:
        (
          await client.query(
            'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1',
          )
        ).rows[0]?.hash ?? null,
      accountReady: (
        await client.query("SELECT count(*)=1 AND bool_and(username='demo') AS ready FROM users")
      ).rows[0].ready,
    });
    for (const [kind, query] of [
      [
        'run',
        `SELECT run_id,scenario_id,previous_run_id,instance_id,fixture_sha256,stage,interval_ms,state,next_line,revision::text,
        verification,verification_document,scenario_verification,scenario_document,scenario_closed_at,close_code,created_at,updated_at
        FROM replay_runs ORDER BY created_at,run_id`,
      ],
      [
        'attempt',
        `SELECT run_id,line_number,batch_index,ingestion_id,state,outcome,reason_code,http_status,
        started_at,finalized_at FROM replay_attempts ORDER BY run_id,line_number`,
      ],
      [
        'receipt',
        `SELECT ingestion_id,state,total,next_index,revision::text,failed_index,failure_code,received_at,updated_at
        FROM ingestion_batches ORDER BY received_at,ingestion_id`,
      ],
    ]) {
      await client.query(`DECLARE export_rows NO SCROLL CURSOR FOR ${query}`);
      for (;;) {
        const { rows } = await client.query('FETCH FORWARD 100 FROM export_rows');
        if (!rows.length) break;
        for (const row of rows) emit(kind, row);
      }
      await client.query('CLOSE export_rows');
    }
    await client.query('COMMIT');
    emit('complete', { complete: true });
  } finally {
    client.release();
  }
} catch {
  // No propagar consultas ni mensajes del servidor.
  process.exitCode = 1;
} finally {
  await pool.end();
}
