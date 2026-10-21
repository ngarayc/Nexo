import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { SessionState } from './session-state';
import { sessionInterceptor } from './session-interceptor';

describe('CSRF solo en la API propia y revocación sin respuestas obsoletas', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([sessionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    return {
      http: TestBed.inject(HttpClient),
      backend: TestBed.inject(HttpTestingController),
      state: TestBed.inject(SessionState),
    };
  }
  const snapshot = {
    user: { id: 'id', username: 'demo' as const },
    csrfToken: 'csrf-in-memory',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };

  it('añade CSRF a DELETE y POST de consulta pero nunca a GET ni a otro origen', () => {
    const { http, backend, state } = setup();
    state.accept(snapshot, state.epoch);
    for (const [method, url, expected] of [
      ['DELETE', '/api/session', true],
      ['POST', '/api/queries/vehicle-events', true],
      ['GET', '/api/session', false],
      ['POST', 'https://example.com/api/session', false],
    ] as const) {
      http.request(method, url).subscribe();
      const request = backend.expectOne(url);
      expect(request.request.headers.has('X-CSRF-Token')).toBe(expected);
      request.flush({});
    }
    backend.verify();
  });

  it('un 403 de la sesión anterior no retira una sesión nueva', () => {
    const { http, backend, state } = setup();
    state.accept(snapshot, state.epoch);
    http.get('/api/session').subscribe({ error: () => undefined });
    const old = backend.expectOne('/api/session');
    state.clear();
    state.accept(snapshot, state.epoch);
    old.flush({ code: 'SESSION_REQUIRED' }, { status: 403, statusText: 'Forbidden' });
    expect(state.session()).not.toBeNull();
    backend.verify();
  });

  it('una restauración tardía tras logout no vuelve a introducir estado', () => {
    const { state } = setup();
    const epoch = state.epoch;
    state.clear();
    expect(state.accept(snapshot, epoch)).toBe(false);
    expect(state.session()).toBeNull();
  });
});
