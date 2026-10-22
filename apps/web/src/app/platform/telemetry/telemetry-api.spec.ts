import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { expect, it } from 'vitest';
import { TelemetryApi } from './telemetry-api';
import { sessionInterceptor } from '../session/session-interceptor';
import { SessionState } from '../session/session-state';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([sessionInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  const state = TestBed.inject(SessionState);
  state.accept(
    {
      user: { id: 'demo-id', username: 'demo' },
      csrfToken: 'a'.repeat(256),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    state.epoch,
  );
  return { api: TestBed.inject(TelemetryApi), backend: TestBed.inject(HttpTestingController) };
}
it('usa GET con segmento codificado para un ID representable y conserva su identidad exacta', async () => {
  const { api, backend } = setup();
  const vehicleId = 'V/ %_🚐';
  const pending = api.history(vehicleId, new AbortController().signal);
  const request = backend.expectOne('/api/vehicles/' + encodeURIComponent(vehicleId) + '/events');
  expect(request.request.method).toBe('GET');
  expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
  request.flush({ vehicleId, items: [], total: 0 });
  expect((await pending).vehicleId).toBe(vehicleId);
  backend.verify();
});
it('IDs largos, NUL o sustitutos aislados usan POST JSON con CSRF y sin API key', async () => {
  const { api, backend } = setup();
  for (const vehicleId of ['V'.repeat(5000), 'V\ud800', 'V\u0000', '.', '..']) {
    const pending = api.history(vehicleId, new AbortController().signal);
    const request = backend.expectOne('/api/queries/vehicle-events');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ vehicleId });
    expect(request.request.headers.get('X-CSRF-Token')).toBe('a'.repeat(256));
    expect(request.request.headers.has('X-API-Key')).toBe(false);
    request.flush({ vehicleId, items: [], total: 0 });
    expect((await pending).vehicleId).toBe(vehicleId);
  }
  backend.verify();
});
it('una respuesta de otro vehículo y un fallo HTTP son errores, nunca un historial vacío', async () => {
  const { api, backend } = setup();
  const crossed = api.history('A', new AbortController().signal);
  backend.expectOne('/api/vehicles/A/events').flush({ vehicleId: 'B', items: [], total: 0 });
  await expect(crossed).rejects.toThrow();
  const failed = api.history('A', new AbortController().signal);
  backend.expectOne('/api/vehicles/A/events').flush({}, { status: 503, statusText: 'Unavailable' });
  await expect(failed).rejects.toThrow();
  backend.verify();
});
it('abortar antes evita HTTP; abortar durante GET o POST cancela la suscripción y rechaza', async () => {
  const { api, backend } = setup();
  const canceled = new AbortController();
  canceled.abort();
  await expect(api.snapshot(canceled.signal)).rejects.toThrow();
  backend.expectNone('/api/snapshot');
  for (const id of ['A', 'V'.repeat(5000)]) {
    const signal = new AbortController();
    const pending = api.history(id, signal.signal);
    const request = backend.expectOne(
      id === 'A' ? '/api/vehicles/A/events' : '/api/queries/vehicle-events',
    );
    signal.abort();
    expect(request.cancelled).toBe(true);
    await expect(pending).rejects.toThrow();
  }
  backend.verify();
});
