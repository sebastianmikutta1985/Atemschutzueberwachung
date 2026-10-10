import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// Druck eines Geraetetraegers: grosse Zahl plus Balken (Anteil am Startdruck), optional mit Marke fuer den
// Rueckzugsdruck. Die Werte kommen fertig berechnet von aussen.
@Component({
  selector: 'app-druck-anzeige',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'druck',
    '[class.druck--lowest]': 'lowest()',
    '[class.druck--retreat]': 'retreatReached()'
  },
  template: `
    <div class="druck__line">
      @if (role()) {
        <span class="druck__role">{{ role() }}</span>
      }
      <span class="druck__name">{{ name() }}</span>
      <span class="druck__value"><span class="druck__number">{{ value() }}</span> bar</span>
    </div>
    <div
      class="druck__bar"
      role="meter"
      aria-valuemin="0"
      [attr.aria-valuemax]="start()"
      [attr.aria-valuenow]="value()"
      [attr.aria-valuetext]="value() + ' bar'"
      [attr.aria-label]="name()"
    >
      <span class="druck__fill" [style.width.%]="fillPercent()"></span>
      @if (retreatPercent() !== null) {
        <span class="druck__mark" [style.left.%]="retreatPercent()"></span>
      }
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
    }
    .druck__line {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      min-width: 0;
    }
    .druck__role {
      font-size: var(--fs-xs);
      font-weight: var(--fw-heavy);
      color: var(--text-muted);
    }
    .druck__name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: var(--fw-semibold);
    }
    .druck__value {
      white-space: nowrap;
      font-size: var(--fs-sm);
      font-weight: var(--fw-bold);
      color: var(--text-muted);
    }
    .druck__number {
      font-size: var(--fs-xl);
      font-weight: var(--fw-heavy);
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }
    .druck__bar {
      position: relative;
      height: var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--surface-sunken);
      border: var(--border-w-thin) solid var(--border);
      overflow: hidden;
    }
    .druck__fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--status-neutral-solid);
      border-radius: inherit;
    }
    .druck__mark {
      position: absolute;
      top: 0;
      bottom: 0;
      width: var(--border-w);
      margin-left: calc(var(--border-w) / -2);
      background: var(--text);
    }
    :host(.druck--lowest) .druck__fill {
      background: var(--text);
    }
    :host(.druck--retreat) .druck__fill {
      background: var(--status-crit-solid);
    }
    :host(.druck--retreat) .druck__number {
      color: var(--status-crit-fg);
    }
  `
})
export class DruckAnzeigeComponent {
  readonly name = input.required<string>();
  readonly value = input.required<number>();
  readonly start = input.required<number>();
  readonly role = input<string>('');
  readonly retreat = input<number | null>(null);
  readonly retreatReached = input(false);
  // Geraet mit dem niedrigsten Druck: danach richtet sich der Trupp
  readonly lowest = input(false);

  readonly fillPercent = computed(() => this.percent(this.value()));
  readonly retreatPercent = computed(() => {
    const r = this.retreat();
    return r === null ? null : this.percent(r);
  });

  private percent(bar: number): number {
    const start = this.start();
    return start > 0 ? Math.min(Math.max((bar / start) * 100, 0), 100) : 0;
  }
}
