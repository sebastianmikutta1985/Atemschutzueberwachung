import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatMinSec } from '../crew-status';

// Grosse Zeitanzeige (Restzeit oder Dauer). Bekommt die Sekunden vom gemeinsamen Takt des MonitoringService,
// hat also keinen eigenen Timer. Feste Ziffernbreite, damit nichts springt.
@Component({
  selector: 'app-countdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'countdown',
    '[attr.data-tone]': 'tone()',
    '[attr.data-size]': 'size()'
  },
  template: `
    <time class="countdown__value" [attr.datetime]="duration()" [attr.aria-label]="label() ? label() + ' ' + text() : null">{{ text() }}</time>
    @if (label()) {
      <span class="countdown__label" aria-hidden="true">{{ label() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-grid;
      justify-items: end;
      gap: var(--space-1);
      color: var(--text);
    }
    .countdown__value {
      font-size: var(--fs-timer);
      font-weight: var(--fw-heavy);
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    :host([data-size='md']) .countdown__value {
      font-size: var(--fs-2xl);
    }
    .countdown__label {
      font-size: var(--fs-xs);
      font-weight: var(--fw-bold);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: var(--tracking-caps);
    }
    :host([data-tone='warn']) {
      color: var(--status-warn-fg);
    }
    :host([data-tone='crit']) {
      color: var(--status-crit-fg);
    }
    :host([data-tone='muted']) {
      color: var(--text-muted);
    }
  `
})
export class CountdownComponent {
  readonly seconds = input.required<number>();
  readonly label = input<string>('');
  readonly tone = input<'default' | 'warn' | 'crit' | 'muted'>('default');
  readonly size = input<'lg' | 'md'>('lg');
  readonly text = computed(() => formatMinSec(this.seconds()));
  // Maschinenlesbare Dauer fuer <time>, z. B. PT12M5S
  readonly duration = computed(() => {
    const s = Math.max(this.seconds(), 0);
    return `PT${Math.floor(s / 60)}M${s % 60}S`;
  });
}
