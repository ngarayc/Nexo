import type { Routes } from '@angular/router';
import { sessionGuard } from './features/access/access-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/access/login-page').then((module) => module.LoginPage),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [sessionGuard],
    loadComponent: () =>
      import('./features/welcome/welcome-page').then((module) => module.WelcomePage),
  },
  { path: '**', redirectTo: '' },
];
