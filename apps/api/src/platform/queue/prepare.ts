import { PgBoss } from 'pg-boss';
import type { PoolClient } from 'pg';
import type { DatabaseConfig } from '../database/config.js';
import { ingestionQueue, queueOptions, queuePolicy, queueSettings } from './policy.js';

// Ejecutado por el preparador propietario bajo su bloqueo, antes de servir HTTP.
export async function prepareQueue(config: DatabaseConfig, client: PoolClient): Promise<void> {
  const boss = new PgBoss(queueOptions(config, true));
  boss.on('error', () => console.error('No fue posible preparar la cola durable.'));
  try {
    await boss.start();
    await boss.createQueue(ingestionQueue, queuePolicy);
    const queue = await boss.getQueue(ingestionQueue);
    if (
      !queue ||
      queue.policy !== queuePolicy.policy ||
      queue.partition !== queuePolicy.partition
    ) {
      throw new Error('La cola existente tiene una política incompatible; no se reemplaza.');
    }
    // policy/partition son inmutables para la biblioteca, incluso con igual valor.
    await boss.updateQueue(ingestionQueue, queueSettings);
    await client.query('REVOKE ALL ON SCHEMA pgboss FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA pgboss TO nexo_app');
    await client.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO nexo_app',
    );
    await client.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO nexo_app');
  } finally {
    await boss.stop({ graceful: false });
  }
}
