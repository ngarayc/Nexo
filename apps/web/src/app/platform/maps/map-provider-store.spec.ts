import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { afterEach, expect, it } from 'vitest';
import { MapProviderStore } from './map-provider-store';

const provider = {
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  allowedOrigin: 'https://tile.openstreetmap.org',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  maxZoom: 18,
};

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { store: TestBed.inject(MapProviderStore), http: TestBed.inject(HttpTestingController) };
}
afterEach(() => TestBed.inject(HttpTestingController).verify());

it('carga configuración pública una vez y conserva un único DTO validado', () => {
  const { store, http } = setup();
  store.load();
  store.load();
  expect(store.phase()).toBe('loading');
  http.expectOne('/map-provider.json').flush(provider);
  expect(store.phase()).toBe('ready');
  expect(store.provider()).toEqual(provider);
  expect(Object.isFrozen(store.provider())).toBe(true);
  store.load();
  http.expectNone('/map-provider.json');
});
it('configuración insegura produce error localizado y permite reintento explícito', () => {
  const { store, http } = setup();
  store.load();
  http
    .expectOne('/map-provider.json')
    .flush({ ...provider, tileUrl: 'https://other.example.com/{z}/{x}/{y}.png' });
  expect(store.phase()).toBe('error');
  expect(store.provider()).toBeUndefined();
  store.load();
  http.expectOne('/map-provider.json').flush(provider);
  expect(store.phase()).toBe('ready');
});
it('fallo HTTP no fabrica proveedor ni inicia un bucle de reintentos', () => {
  const { store, http } = setup();
  store.load();
  http.expectOne('/map-provider.json').flush(null, { status: 503, statusText: 'Unavailable' });
  expect(store.phase()).toBe('error');
  expect(store.provider()).toBeUndefined();
  http.expectNone('/map-provider.json');
});
