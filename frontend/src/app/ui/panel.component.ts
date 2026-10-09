import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// Inhaltsfeld mit Ueberschrift, optionaler Zusatzinfo und Aktionen rechts.
@Component({
  selector: 'app-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <header class="panel__head">
        <h2 class="panel__title">{{ heading() }}</h2>
        @if (meta()) {
          <span class="panel__meta">{{ meta() }}</span>
        }
        <div class="panel__actions"><ng-content select="[panel-actions]" /></div>
      </header>
      <div class="panel__body"><ng-content /></div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .panel {
      display: grid;
      gap: var(--space-4);
      padding: var(--space-5);
      background: var(--surface);
      border: var(--border-w) solid var(--border);
      border-radius: var(--radius-lg);
    }
    .panel__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-1) var(--space-3);
    }
    .panel__title {
      font-size: var(--fs-xl);
      font-weight: var(--fw-heavy);
    }
    .panel__meta {
      color: var(--text-muted);
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
    }
    .panel__actions {
      display: flex;
      gap: var(--touch-gap);
      margin-left: auto;
    }
    .panel__actions:empty {
      display: none;
    }
    .panel__body {
      display: grid;
      gap: var(--space-4);
      min-width: 0;
    }
    @media (max-width: 520px) {
      .panel {
        padding: var(--space-4);
      }
    }
  `
})
export class PanelComponent {
  readonly heading = input.required<string>();
  readonly meta = input<string>('');
}
