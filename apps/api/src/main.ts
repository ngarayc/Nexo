import { createApplication } from './app.factory.js';
import { readServerConfig } from './platform/config.js';

async function bootstrap(): Promise<void> {
  const config = readServerConfig(process.env);
  const app = await createApplication();
  try {
    await app.listen(config.port, config.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch(() => {
  console.error('No fue posible iniciar Nexo. Revisa la configuración y el puerto.');
  process.exitCode = 1;
});
