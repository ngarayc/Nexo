import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const paths = {
  nexo: 'M4 17V7l8 10V7M12 7l8 10V7M4 12h16',
  fleet: 'M4 16V9l2-5h12l2 5v7M4 10h16M7 14h.01M17 14h.01M6 16v4M18 16v4M4 16h16',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  alert: 'M12 3 2 20h20L12 3ZM12 9v4M12 17h.01',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  logout: 'M9 4H4v16h5M10 12h11M17 8l4 4-4 4',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l5 5',
  close: 'M6 6l12 12M18 6 6 18',
  history: 'M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2',
  focus: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  pin: 'M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13ZM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M7 4v16M17 4v16',
  restart: 'M3 11a9 9 0 1 1 3 8M3 4v7h7',
  check: 'm5 12 4 4L19 6',
  list: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  shield: 'm12 3 9 4v5c0 5-9 9-9 9s-9-4-9-9V7l9-4Zm-4 9 3 3 5-6',
  power: 'M12 2v10M6 5a9 9 0 1 0 12 0',
  route:
    'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9 6h6a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h6',
  filter: 'M3 4h18l-7 8v7l-4 2v-9L3 4Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  chevron: 'm8 5 7 7-7 7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
} as const;
export type IconName = keyof typeof paths;

@Component({
  selector: 'nexo-icon',
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path [attr.d]="paths[name()]" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: 0 0 auto;
      width: 1.25rem;
      height: 1.25rem;
      vertical-align: middle;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly paths = paths;
}
