import type { Routes } from '@angular/router';
import { sessionGuard } from './features/access/access-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/access/login-page').then((module) => module.LoginPage),
  },
  {
    path: '',
    canActivate: [sessionGuard],
    loadComponent: () => import('./platform/layout/app-shell').then((module) => module.AppShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/fleet/fleet-page').then((module) => module.FleetPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
