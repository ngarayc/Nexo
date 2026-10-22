import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, it, vi } from 'vitest';
import { SessionState } from './session-state';

function setup() {
  TestBed.configureTestingModule({
    providers: [{ provide: Router, useValue: { navigateByUrl: vi.fn(async () => true) } }],
  });
  return TestBed.inject(SessionState);
}
const snapshot = () => ({
  user: { id: 'demo-id', username: 'demo' as const },
  csrfToken: 'a'.repeat(256),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
it('otro token sincronizado invalida respuestas pendientes del ámbito anterior sin leer cookies', () => {
  const state = setup(),
    initial = snapshot();
  state.accept(initial, state.epoch);
  const epoch = state.epoch;
  state.accept({ ...initial, csrfToken: 'b'.repeat(256) }, epoch);
  expect(state.epoch).toBe(epoch + 1);
  expect(state.accept(initial, epoch)).toBe(false);
  expect(state.session()?.csrfToken).toBe('b'.repeat(256));
});
it('comprobar la misma sesión conserva su época y vencimiento absoluto', () => {
  const state = setup(),
    initial = snapshot();
  state.accept(initial, state.epoch);
  const epoch = state.epoch;
  state.accept({ ...initial }, epoch);
  expect(state.epoch).toBe(epoch);
  expect(state.session()?.expiresAt).toBe(initial.expiresAt);
});
it('una sesión vencida y una restauración posterior a clear no se aceptan', () => {
  const state = setup(),
    initial = snapshot();
  expect(state.accept({ ...initial, expiresAt: new Date(0).toISOString() }, state.epoch)).toBe(
    false,
  );
  const epoch = state.epoch;
  state.clear();
  expect(state.accept(initial, epoch)).toBe(false);
  expect(state.session()).toBeNull();
});
