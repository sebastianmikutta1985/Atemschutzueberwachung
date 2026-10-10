import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DisplayStatus } from '../crew/display-status';
import { IconComponent, IconName } from './icon.component';
import { TranslatePipe } from './translate.pipe';

// Status immer als Farbe + Icon + Text, nie nur Farbe.
const META: Record<DisplayStatus, { icon: IconName; key: string }> = {
  ok: { icon: 'check', key: 'ui.status.ok' },
  rueckzug: { icon: 'alert-triangle', key: 'ui.status.rueckzug' },
  ueberfaellig: { icon: 'alert-circle', key: 'ui.status.ueberfaellig' },
  funkausfall: { icon: 'radio-off', key: 'ui.status.funkausfall' },
  mayday: { icon: 'alert-octagon', key: 'ui.status.mayday' },
  beendet: { icon: 'check-circle', key: 'ui.status.beendet' }
};

@Component({
  selector: 'app-status-badge',
  imports: [IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'status-badge',
    '[attr.data-status]': 'status()',
    '[attr.data-size]': 'size()'
  },
  template: `
    <app-icon [name]="meta().icon" [size]="size() === 'lg' ? 'md' : 'sm'" />
    <span class="status-badge__text">{{ meta().key | t }}</span>
  `,
  styles: `
    :host {
      --badge-bg: var(--status-ok-solid);
      --badge-fg: var(--status-ok-on);
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);
      min-height: var(--space-8);
      border-radius: var(--radius-pill);
      background: var(--badge-bg);
      color: var(--badge-fg);
      font-size: var(--fs-xs);
      font-weight: var(--fw-heavy);
      letter-spacing: var(--tracking-caps);
      text-transform: uppercase;
      line-height: 1;
      white-space: nowrap;
    }
    :host([data-size='lg']) {
      min-height: var(--space-10);
      padding: var(--space-2) var(--space-4) var(--space-2) var(--space-3);
      font-size: var(--fs-sm);
      gap: var(--space-2);
    }
    :host([data-status='rueckzug']) {
      --badge-bg: var(--status-warn-solid);
      --badge-fg: var(--status-warn-on);
    }
    :host([data-status='ueberfaellig']),
    :host([data-status='mayday']) {
      --badge-bg: var(--status-crit-solid);
      --badge-fg: var(--status-crit-on);
    }
    :host([data-status='funkausfall']) {
      --badge-bg: var(--status-radio-solid);
      --badge-fg: var(--status-radio-on);
    }
    :host([data-status='beendet']) {
      --badge-bg: var(--status-neutral-bg);
      --badge-fg: var(--status-neutral-fg);
    }
  `
})
export class StatusBadgeComponent {
  readonly status = input.required<DisplayStatus>();
  readonly size = input<'md' | 'lg'>('md');
  readonly meta = computed(() => META[this.status()]);
}
