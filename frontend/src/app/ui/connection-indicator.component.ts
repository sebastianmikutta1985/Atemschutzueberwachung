import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent, IconName } from './icon.component';
import { TranslatePipe } from './translate.pipe';

export type LiveStatus = 'connected' | 'connecting' | 'disconnected';

// Zeigt jederzeit, ob die angezeigten Daten live sind: Live / Verbindet / Offline (mit Stand).
@Component({
  selector: 'app-connection-indicator',
  imports: [DatePipe, IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'conn',
    role: 'status',
    '[attr.data-state]': 'state()'
  },
  template: `
    <app-icon [name]="icon()" size="sm" />
    <span class="conn__text">
      <span class="conn__label">{{ labelKey() | t }}</span>
      @if (state() === 'disconnected' && snapshotFrom()) {
        <span class="conn__detail">{{ 'ui.connection.snapshot' | t: { time: (snapshotFrom() | date: 'HH:mm') ?? '' } }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      --conn-fg: var(--status-ok-fg);
      --conn-bg: var(--status-ok-bg);
      --conn-border: var(--status-ok-solid);
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--touch-min);
      padding: var(--space-1) var(--space-3);
      border: var(--border-w) solid var(--conn-border);
      border-radius: var(--radius-pill);
      background: var(--conn-bg);
      color: var(--conn-fg);
      font-size: var(--fs-sm);
      font-weight: var(--fw-bold);
      white-space: nowrap;
    }
    :host([data-state='connecting']) {
      --conn-fg: var(--status-warn-fg);
      --conn-bg: var(--status-warn-bg);
      --conn-border: var(--status-warn-solid);
    }
    :host([data-state='disconnected']) {
      --conn-fg: var(--status-crit-fg);
      --conn-bg: var(--status-crit-bg);
      --conn-border: var(--status-crit-solid);
    }
    .conn__text {
      display: grid;
      line-height: var(--lh-tight);
    }
    .conn__detail {
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
    }
  `
})
export class ConnectionIndicatorComponent {
  readonly status = input.required<LiveStatus>();
  // Verbindung laenger weg (nicht nur kurzer Wiederaufbau): wie offline behandeln.
  readonly lost = input(false);
  readonly snapshotFrom = input<string | null>(null);

  readonly state = computed<LiveStatus>(() => (this.lost() ? 'disconnected' : this.status()));
  readonly icon = computed<IconName>(() => {
    switch (this.state()) {
      case 'connected':
        return 'live';
      case 'connecting':
        return 'sync';
      default:
        return 'offline';
    }
  });
  readonly labelKey = computed(() => `ui.connection.${this.state()}`);
}
