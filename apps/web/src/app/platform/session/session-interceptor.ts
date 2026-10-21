import { inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { SessionState } from './session-state';

export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  const state = inject(SessionState);
  const epoch = state.epoch;
  const local = request.url.startsWith('/api/');
  const csrf = state.session()?.csrfToken;
  const mutates = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const authorized =
    local && mutates && csrf ? request.clone({ setHeaders: { 'X-CSRF-Token': csrf } }) : request;
  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (
        local &&
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        typeof error.error === 'object' &&
        error.error !== null &&
        error.error.code === 'SESSION_REQUIRED' &&
        epoch === state.epoch
      )
        state.expire();
      return throwError(() => error);
    }),
  );
};
