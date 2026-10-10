import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Eigene Inline-SVG-Icons (24er Raster, Strich in currentColor). Keine Bibliothek, keine extra Assets fuer den
// Service Worker. Kreise sind als Pfade geschrieben, damit jedes Icon nur aus <path> besteht.
const CIRCLE = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const ICONS = {
  check: ['M20 6 9 17l-5-5'],
  'check-circle': [CIRCLE(12, 12, 10), 'm8 12 3 3 5-6'],
  'alert-triangle': ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
  'alert-circle': [CIRCLE(12, 12, 10), 'M12 7v6', 'M12 16.5h.01'],
  'alert-octagon': ['M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z', 'M12 7v6', 'M12 16.5h.01'],
  'radio-off': ['M3 3l18 18', 'M8.5 15.5a5 5 0 0 1-.8-6', 'M5.1 19a10 10 0 0 1-1-12.9', 'M15.5 8.5a5 5 0 0 1 1 5', 'M18.9 5a10 10 0 0 1 1.9 10.6'],
  live: ['M4.9 19.1a10 10 0 0 1 0-14.2', 'M7.8 16.2a6 6 0 0 1 0-8.4', 'M16.2 7.8a6 6 0 0 1 0 8.4', 'M19.1 4.9a10 10 0 0 1 0 14.2', CIRCLE(12, 12, 2)],
  sync: ['M21 12a9 9 0 0 1-15.5 6.3L3 16', 'M3 21v-5h5', 'M3 12a9 9 0 0 1 15.5-6.3L21 8', 'M21 3v5h-5'],
  offline: ['M3 3l18 18', 'M5.8 8.8A6 6 0 0 0 7 20h10', 'M21.4 16.6A4.5 4.5 0 0 0 18 9h-1.3A8 8 0 0 0 9.4 4.4'],
  clock: [CIRCLE(12, 12, 10), 'M12 6v6l4 2'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  sun: [CIRCLE(12, 12, 4), 'M12 2v2', 'M12 20v2', 'm4.9 4.9 1.4 1.4', 'm17.7 17.7 1.4 1.4', 'M2 12h2', 'M20 12h2', 'm6.3 17.7-1.4 1.4', 'm19.1 4.9-1.4 1.4'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  gauge: ['m12 14 4-4', 'M3.3 19a10 10 0 1 1 17.4 0'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-left': ['M19 12H5', 'm12 19-7-7 7-7'],
  'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
  'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  key: [CIRCLE(7.5, 15.5, 4.5), 'm10.7 12.3 9.3-9.3', 'm16 6 3 3', 'm14 8 2 2'],
  lock: ['M5 11h14v10H5Z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  'arrow-return': ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  target: [CIRCLE(12, 12, 10), CIRCLE(12, 12, 6), CIRCLE(12, 12, 2)],
  'chevron-down': ['m6 9 6 6 6-6'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', CIRCLE(12, 7, 4)],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  info: [CIRCLE(12, 12, 10), 'M12 16v-5', 'M12 7.5h.01'],
  volume: ['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  globe: [CIRCLE(12, 12, 10), 'M2 12h20', 'M12 2a15 15 0 0 1 0 20', 'M12 2a15 15 0 0 0 0 20'],
  pending: [CIRCLE(12, 12, 10), 'M8 12h.01', 'M12 12h.01', 'M16 12h.01']
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'icon',
    '[attr.data-size]': 'size()',
    // Rein dekorativ: die Bedeutung steht immer auch als Text daneben (oder als aria-label am Button).
    'aria-hidden': 'true'
  },
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: 0 0 auto;
      width: var(--icon-md);
      height: var(--icon-md);
    }
    :host([data-size='sm']) {
      width: var(--icon-sm);
      height: var(--icon-sm);
    }
    :host([data-size='lg']) {
      width: var(--icon-lg);
      height: var(--icon-lg);
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly paths = computed(() => ICONS[this.name()]);
}
