import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, IconName } from './icon.component';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn';

// Natives <button> bleibt das Element (Tastatur, Formulare, Fokus), die Komponente liefert nur Aussehen und Icon.
@Component({
  selector: 'button[appButton], a[appButton]',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'btn',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[class.btn--block]': 'block()',
    '[class.btn--attention]': 'attention()'
  },
  template: `
    @if (icon(); as name) {
      <app-icon [name]="name" [size]="size() === 'lg' ? 'md' : 'sm'" />
    }
    <span class="btn__label"><ng-content /></span>
  `,
  styles: `
    :host {
      --btn-bg: var(--surface-raised);
      --btn-fg: var(--text);
      --btn-border: var(--border-strong);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: var(--touch-min);
      padding: var(--space-2) var(--space-4);
      border: var(--border-w) solid var(--btn-border);
      border-radius: var(--radius-md);
      background: var(--btn-bg);
      color: var(--btn-fg);
      font-size: var(--fs-base);
      font-weight: var(--fw-bold);
      line-height: var(--lh-tight);
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }
    :host([data-size='lg']) {
      min-height: var(--touch-primary);
      padding: var(--space-3) var(--space-5);
      font-size: var(--fs-lg);
      border-radius: var(--radius-lg);
    }
    :host([data-size='sm']) {
      min-height: var(--touch-min);
      padding: var(--space-1) var(--space-3);
      font-size: var(--fs-sm);
    }
    :host([data-variant='primary']) {
      --btn-bg: var(--primary);
      --btn-fg: var(--primary-contrast);
      --btn-border: var(--primary);
    }
    :host([data-variant='primary']:not(:disabled):hover) {
      --btn-bg: var(--primary-hover);
      --btn-border: var(--primary-hover);
    }
    :host([data-variant='ghost']) {
      --btn-bg: transparent;
    }
    :host([data-variant='danger']) {
      --btn-bg: var(--status-crit-solid);
      --btn-fg: var(--status-crit-on);
      --btn-border: var(--status-crit-solid);
    }
    :host([data-variant='warn']) {
      --btn-bg: var(--status-warn-solid);
      --btn-fg: var(--status-warn-on);
      --btn-border: var(--status-warn-solid);
    }
    /* Faellige Aktion: kraeftiger Rand in Warnfarbe, zusaetzlich zur Beschriftung */
    :host(.btn--attention) {
      --btn-border: var(--status-warn-solid);
      box-shadow: 0 0 0 var(--border-w) var(--status-warn-solid);
    }
    :host(.btn--block) {
      display: flex;
      width: 100%;
    }
    .btn__label {
      min-width: 0;
    }
  `
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly icon = input<IconName | null>(null);
  readonly block = input(false);
  readonly attention = input(false);
}

// Quadratischer Button nur mit Icon. Das Label ist Pflicht und wird zu aria-label und Tooltip.
@Component({
  selector: 'button[appIconButton], a[appIconButton]',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'icon-btn',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.data-variant]': 'variant()'
  },
  template: `<app-icon [name]="icon()" />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--touch-min);
      min-width: var(--touch-min);
      height: var(--touch-min);
      min-height: var(--touch-min);
      padding: 0;
      border: var(--border-w) solid var(--border-strong);
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }
    :host([data-variant='plain']) {
      border-color: transparent;
    }
  `
})
export class IconButtonComponent {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly variant = input<'outline' | 'plain'>('outline');
}
