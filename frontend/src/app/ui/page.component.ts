import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from './button.component';
import { TranslatePipe } from './translate.pipe';

// Rahmen fuer die Nebenseiten (Einstellungen, Hersteller-Portal, Rechtliches): Kopfleiste mit Schriftzug und
// Aktionen, Titel mit Zurueck-Link, darunter der Inhalt.
@Component({
  selector: 'app-page',
  imports: [RouterLink, ButtonComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <div class="page-head__bar">
        <span class="page-head__wordmark">CrewTrace</span>
        <div class="page-head__actions"><ng-content select="[page-actions]" /></div>
      </div>
    </header>
    <main class="page-body" [class.page-body--narrow]="narrow()">
      <div class="page-title">
        @if (backLink(); as link) {
          <a appButton variant="ghost" icon="arrow-left" [routerLink]="link">{{ 'common.back' | t }}</a>
        }
        <div class="page-title__text">
          <h1>{{ heading() }}</h1>
          @if (subtitle()) {
            <p>{{ subtitle() }}</p>
          }
        </div>
      </div>
      <ng-content />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
    .page-head {
      position: sticky;
      top: 0;
      z-index: var(--z-header);
      background: var(--surface);
      border-bottom: var(--border-w) solid var(--border);
    }
    .page-head__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-4);
      max-width: var(--page-max);
      margin: 0 auto;
      padding: var(--space-2) var(--page-gutter);
      min-height: var(--touch-primary);
    }
    .page-head__wordmark {
      font-size: var(--fs-lg);
      font-weight: var(--fw-heavy);
      letter-spacing: var(--tracking-caps);
    }
    .page-head__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--touch-gap);
    }
    .page-body {
      display: grid;
      gap: var(--space-6);
      max-width: var(--page-max);
      margin: 0 auto;
      padding: var(--space-6) var(--page-gutter) var(--space-12);
    }
    .page-body--narrow {
      max-width: calc(var(--dialog-max) + 2 * var(--page-gutter));
    }
    .page-title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3) var(--space-4);
    }
    .page-title__text {
      display: grid;
      gap: var(--space-1);
    }
    .page-title h1 {
      font-size: var(--fs-2xl);
      font-weight: var(--fw-heavy);
    }
    .page-title p {
      margin: 0;
      color: var(--text-muted);
      font-weight: var(--fw-semibold);
    }
  `
})
export class PageComponent {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>('');
  readonly backLink = input<string | null>(null);
  // Schmale Spalte fuer Formulare und Fliesstext
  readonly narrow = input(false);
}
