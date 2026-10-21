import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/welcome/welcome-page').then((module) => module.WelcomePage),
  },
  { path: '**', redirectTo: '' },
];
