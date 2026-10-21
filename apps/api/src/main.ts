import { createApplication } from './app.factory.js';
import { readServerConfig } from './platform/config.js';

async function bootstrap(): Promise<void> {
  const config = readServerConfig(process.env);
  const app = await createApplication();
  await app.listen(config.port, config.host);
}

bootstrap().catch(() => {
  console.error('No fue posible iniciar Nexo. Revisa la configuración y el puerto.');
  process.exitCode = 1;
});
