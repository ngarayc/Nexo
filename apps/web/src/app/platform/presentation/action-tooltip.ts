import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, inject, input, OnDestroy } from '@angular/core';

let sequence = 0;

// Fuera de tablas/mapas para no recortarse por overflow o capas Leaflet.
@Directive({
  selector: '[nexoTooltip]',
  host: {
    '[attr.aria-label]': 'label()',
    '(pointerenter)': 'show()',
    '(pointerleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(click)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class ActionTooltip implements OnDestroy {
  readonly label = input.required<string>({ alias: 'nexoTooltip' });
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private node: HTMLDivElement | undefined;
  private readonly dismiss = () => this.hide();

  show(): void {
    if (this.node || !this.label()) return;
    const node = this.document.createElement('div');
    node.id = `nexo-tooltip-${++sequence}`;
    node.className = 'nexo-action-tooltip';
    node.setAttribute('role', 'tooltip');
    const characters = Array.from(this.label());
    node.textContent =
      characters.length > 200 ? characters.slice(0, 200).join('') + '…' : this.label();
    this.document.body.append(node);
    this.node = node;
    const rect = this.host.getBoundingClientRect();
    const width = this.document.documentElement.clientWidth;
    const size = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - size.width / 2, width - size.width - 8))}px`;
    const top = rect.top >= size.height + 12 ? rect.top - size.height - 8 : rect.bottom + 8;
    node.style.top = `${Math.max(8, Math.min(top, this.document.documentElement.clientHeight - size.height - 8))}px`;
    const previous = this.host.getAttribute('aria-describedby');
    this.host.setAttribute('aria-describedby', [previous, node.id].filter(Boolean).join(' '));
    this.document.addEventListener('scroll', this.dismiss, true);
    this.document.defaultView?.addEventListener('resize', this.dismiss);
  }
  hide(): void {
    const node = this.node;
    if (!node) return;
    const remaining = (this.host.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((id) => id && id !== node.id);
    if (remaining.length) this.host.setAttribute('aria-describedby', remaining.join(' '));
    else this.host.removeAttribute('aria-describedby');
    node.remove();
    this.node = undefined;
    this.document.removeEventListener('scroll', this.dismiss, true);
    this.document.defaultView?.removeEventListener('resize', this.dismiss);
  }
  ngOnDestroy(): void {
    this.hide();
  }
}
