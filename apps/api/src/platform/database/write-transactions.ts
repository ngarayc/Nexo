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
