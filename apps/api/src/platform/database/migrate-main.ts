import { readDatabaseConfig } from './config.js';
import { prepareDatabase } from './prepare.js';

async function prepare(): Promise<void> {
  await prepareDatabase(readDatabaseConfig(process.env, true));
}

prepare().catch(() => {
  console.error(
    'No fue posible preparar la base: comprueba configuración, conexión y migraciones.',
  );
  process.exitCode = 1;
});
