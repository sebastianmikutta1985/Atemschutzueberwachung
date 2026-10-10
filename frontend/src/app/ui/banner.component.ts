import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent, IconName } from './icon.component';

export type BannerTone = 'info' | 'warn' | 'crit' | 'mayday';

const ICON: Record<BannerTone, IconName> = {
  info: 'info',
  warn: 'alert-triangle',
  crit: 'alert-circle',
  mayday: 'alert-octagon'
};

// Hinweisleiste (Verbindung, Offline-Warteschlange, Update, Ton, Mayday). Kritische Toene werden als alert
// angesagt, die uebrigen als status.
@Component({
  selector: 'app-banner',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'banner',
    '[attr.data-tone]': 'tone()',
    '[attr.role]': "tone() === 'info' ? 'status' : 'alert'"
  },
  template: `
    <app-icon [name]="iconName()" />
    <div class="banner__content"><ng-content /></div>
    <div class="banner__actions"><ng-content select="[banner-actions]" /></div>
  `,
  styles: `
    :host {
      --banner-bg: var(--surface-raised);
      --banner-fg: var(--text);
      --banner-border: var(--border-strong);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: var(--border-w) solid var(--banner-border);
      border-radius: var(--radius-md);
      background: var(--banner-bg);
      color: var(--banner-fg);
      font-weight: var(--fw-semibold);
    }
    :host([data-tone='warn']) {
      --banner-bg: var(--status-warn-bg);
      --banner-fg: var(--status-warn-fg);
      --banner-border: var(--status-warn-solid);
    }
    :host([data-tone='crit']) {
      --banner-bg: var(--status-crit-bg);
      --banner-fg: var(--status-crit-fg);
      --banner-border: var(--status-crit-solid);
    }
    :host([data-tone='mayday']) {
      --banner-bg: var(--status-crit-solid);
      --banner-fg: var(--status-crit-on);
      --banner-border: var(--status-crit-strong);
    }
    .banner__content {
      flex: 1 1 var(--size-text-min);
      min-width: 0;
      display: grid;
      gap: var(--space-1);
    }
    .banner__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--touch-gap);
    }
    .banner__actions:empty {
      display: none;
    }
  `
})
export class BannerComponent {
  readonly tone = input<BannerTone>('info');
  readonly icon = input<IconName | null>(null);
  readonly iconName = computed(() => this.icon() ?? ICON[this.tone()]);
}
