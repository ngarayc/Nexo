import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionTooltip } from './action-tooltip';

@Component({
  imports: [ActionTooltip],
  template: `<p id="hint">Contexto</p>
    <button nexoTooltip="Ver historial" aria-describedby="hint">◎</button>`,
})
class Host {}

afterEach(() => TestBed.resetTestingModule());

describe('acciones con icono y tooltip', () => {
  it('ofrece nombre accesible y descripción al enfocar; Escape no roba el foco ni elimina la descripción original', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(button.getAttribute('aria-label')).toBe('Ver historial');
    expect(tooltip?.textContent).toBe('Ver historial');
    expect(button.getAttribute('aria-describedby')).toContain('hint');
    expect(button.getAttribute('aria-describedby')).toContain(tooltip?.id);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe('hint');
    expect(document.activeElement).toBe(button);
  });
  it('retira la ayuda al desplazar un contenedor o destruir la vista', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new Event('pointerenter'));
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    document.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    button.dispatchEvent(new Event('pointerenter'));
    fixture.destroy();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});

it('resume una ayuda extensa sin recortar el nombre accesible ni interpretar HTML', () => {
  @Component({ imports: [ActionTooltip], template: `<button [nexoTooltip]="label">◎</button>` })
  class LongHost {
    readonly label = '<img src=x onerror=alert(1)> ' + 'v'.repeat(300);
  }
  const fixture = TestBed.createComponent(LongHost);
  fixture.detectChanges();
  const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  button.focus();
  expect(button.getAttribute('aria-label')).toBe(fixture.componentInstance.label);
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toHaveLength(201);
  expect(tooltip?.textContent?.endsWith('…')).toBe(true);
  expect(tooltip?.querySelector('img')).toBeNull();
});
