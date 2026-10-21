import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { AccessFacade } from './access-facade';

export const sessionGuard: CanActivateFn = async () => {
  const router = inject(Router);
  return (await inject(AccessFacade).ensure()) || router.createUrlTree(['/login']);
};
