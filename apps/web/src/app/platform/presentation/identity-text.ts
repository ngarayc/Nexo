import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

function invisible(character: string): boolean {
  const point = character.codePointAt(0)!;
  return (
    point <= 0x1f ||
    point === 0x061c ||
    (point >= 0x7f && point <= 0x9f) ||
    point === 0x200e ||
    point === 0x200f ||
    (point >= 0x2028 && point <= 0x202e) ||
    (point >= 0x2066 && point <= 0x2069) ||
    (point >= 0xd800 && point <= 0xdfff)
  );
}
export function formatIdentity(value: string): string {
  let visible = '';
  for (const character of value) {
    visible +=
      character === '\\'
        ? '\\\\'
        : invisible(character)
          ? '\\u' + character.codePointAt(0)!.toString(16).padStart(4, '0')
          : character;
  }
  return visible;
}
export function identityPreview(value: string): string {
  const characters = Array.from(formatIdentity(value));
  return characters.length > 72 ? characters.slice(0, 72).join('') + '…' : characters.join('');
}
@Component({
  selector: 'nexo-identity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (long()) {
      <details>
        <summary>{{ preview() }} <span>Ver completo</span></summary>
        <code class="full" tabindex="0">{{ text() }}</code>
      </details>
    } @else {
      <code>{{ text() }}</code>
    }
    @if (escaped()) {
      <span class="explanation">Identificador representado con escapes Unicode.</span>
    }
  `,
  styles: `
    :host {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    code {
      white-space: pre-wrap;
      font-size: 0.875rem;
    }
    summary {
      cursor: pointer;
      overflow-wrap: anywhere;
    }
    summary span,
    .explanation {
      display: block;
      color: #526970;
      font-size: 0.75rem;
    }
    .full {
      display: block;
      max-height: 12rem;
      overflow: auto;
      padding: 0.5rem;
      border: 1px solid #dbe6e5;
    }
  `,
})
export class IdentityText {
  readonly value = input.required<string>();
  readonly text = computed(() => formatIdentity(this.value()));
  readonly preview = computed(() => identityPreview(this.value()));
  readonly long = computed(() => this.text().length > 80);
  readonly escaped = computed(() => this.text() !== this.value());
}
