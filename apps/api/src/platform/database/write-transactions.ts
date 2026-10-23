import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Drizzle usa el cliente reservado durante toda la transacción. Ante error se
// descarta el socket: una respuesta perdida no puede devolverlo al pool como sano.
export class WriteTransactions {
  constructor(private readonly pool: Pool) {}

  async run<T>(operation: (tx: NodePgDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let confirmed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL transaction_timeout='10s'");
      // Compartido entre admisión, procesamiento, recuperación y diario.
      // La limpieza demo toma el exclusivo antes de comprobar/vaciar datos.
      await client.query('SELECT pg_advisory_xact_lock_shared(72416004)');
      const result = await operation(drizzle(client));
      await client.query('COMMIT');
      confirmed = true;
      return result;
    } finally {
      // Descartar evita reutilización; no demuestra si COMMIT llegó a confirmarse.
      client.release(!confirmed);
    }
  }
}
