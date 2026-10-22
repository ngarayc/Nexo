import { TestBed } from '@angular/core/testing';
import { expect, it } from 'vitest';
import { IdentityText, formatIdentity, identityPreview } from './identity-text';

it('representa controles y sustitutos sin confundirlos con secuencias de escape literales', () => {
  expect(formatIdentity('V\u0000\ud800\u202e')).toBe('V\\u0000\\ud800\\u202e');
  expect(formatIdentity('V\\u0000')).toBe('V\\\\u0000');
  expect(formatIdentity('V\u061c')).toBe('V\\u061c');
  expect(formatIdentity('VEH_01%🚐')).toBe('VEH_01%🚐');
  expect(identityPreview('🚐'.repeat(80))).toBe('🚐'.repeat(72) + '…');
});
it('un ID con apariencia de HTML se presenta como texto sin crear elementos', async () => {
  const fixture = TestBed.createComponent(IdentityText);
  const value = '<img src=x onerror="alert(1)">';
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('code')?.textContent).toBe(value);
});
it('un identificador largo queda completo en un detalle accesible por teclado', async () => {
  const fixture = TestBed.createComponent(IdentityText);
  const value = 'V'.repeat(70000);
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('summary')?.textContent).toContain('Ver completo');
  expect(root.querySelector('code')?.textContent).toBe(value);
});
