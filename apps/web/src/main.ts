import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch(() => {
  console.error('No fue posible iniciar la interfaz de Nexo.');
});
