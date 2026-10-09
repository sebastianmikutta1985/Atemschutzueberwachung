import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnDestroy,
  output,
  viewChild,
  ViewEncapsulation
} from '@angular/core';
import { IconButtonComponent } from './button.component';
import { IconComponent, IconName } from './icon.component';
import { TranslatePipe } from './translate.pipe';

let nextId = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Gemeinsames Geruest fuer alle Dialoge: Hintergrund, Titel, Fokus im Dialog halten, Esc, Fokus zurueckgeben.
// Inhalt per Projektion; Aktionen entweder ueber [dialog-actions] oder als .dialog__actions innerhalb eines
// eigenen <form> (damit Submit-Buttons im Formular bleiben).
@Component({
  selector: 'app-dialog',
  imports: [IconButtonComponent, IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Klassen sind mit dialog__ bzw. modal__ benannt; .dialog__actions muss auch in projizierten Formularen greifen.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'modal dialog-host',
    '[attr.data-tone]': 'tone()'
  },
  template: `
    <div class="modal__backdrop" (click)="onBackdrop()"></div>
    <div
      #panel
      class="modal__panel dialog"
      [attr.role]="role()"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      tabindex="-1"
      (keydown)="onKeydown($event)"
    >
      <header class="dialog__head">
        @if (icon(); as name) {
          <app-icon class="dialog__icon" [name]="name" size="lg" />
        }
        <h2 class="dialog__title" [id]="titleId">{{ heading() }}</h2>
        @if (closable()) {
          <button appIconButton type="button" icon="close" variant="plain" [label]="'common.close' | t" (click)="close.emit()"></button>
        }
      </header>
      <div class="dialog__body">
        <ng-content />
      </div>
      <ng-content select="[dialog-actions]" />
    </div>
  `,
  styles: `
    .dialog-host {
      position: fixed;
      inset: 0;
      z-index: var(--z-dialog);
      display: grid;
      place-items: center;
      padding: var(--space-4);
    }
    .dialog-host[data-tone='alarm'] {
      z-index: var(--z-alarm);
    }
    .dialog-host > .modal__backdrop {
      position: absolute;
      inset: 0;
      background: var(--backdrop);
    }
    .dialog-host[data-tone='alarm'] > .modal__backdrop {
      background: var(--backdrop-alarm);
    }
    .dialog {
      position: relative;
      display: grid;
      gap: var(--space-4);
      width: min(var(--dialog-max), 100%);
      min-width: 0;
      max-width: none;
      max-height: calc(100dvh - 2 * var(--space-4));
      overflow: auto;
      padding: var(--space-6);
      background: var(--surface);
      color: var(--text);
      border: var(--border-w) solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-2);
    }
    .dialog-host[data-tone='warn'] .dialog {
      border-color: var(--status-warn-solid);
      border-top-width: var(--space-2);
    }
    .dialog-host[data-tone='crit'] .dialog,
    .dialog-host[data-tone='alarm'] .dialog {
      border-color: var(--status-crit-solid);
      border-top-width: var(--space-2);
    }
    /* Der Dialog selbst bekommt nur programmatisch Fokus (ohne Eingabefeld): kein Rahmen um das ganze Feld */
    .dialog:focus {
      outline: none;
    }
    .dialog__head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .dialog-host[data-tone='warn'] .dialog__icon {
      color: var(--status-warn-fg);
    }
    .dialog-host[data-tone='crit'] .dialog__icon,
    .dialog-host[data-tone='alarm'] .dialog__icon {
      color: var(--status-crit-fg);
    }
    .dialog__title {
      flex: 1;
      font-size: var(--fs-xl);
      font-weight: var(--fw-heavy);
    }
    /* Alarme: Titel gross und in Alarmfarbe */
    .dialog-host[data-tone='alarm'] .dialog__title {
      font-size: var(--fs-2xl);
      color: var(--status-crit-fg);
      letter-spacing: var(--tracking-caps);
    }
    .dialog__body {
      display: grid;
      gap: var(--space-4);
    }
    .dialog__body > form {
      display: grid;
      gap: var(--space-4);
    }
    .dialog__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--touch-gap);
      justify-content: flex-end;
      padding-top: var(--space-2);
    }
    .dialog__actions > button {
      min-height: var(--touch-primary);
      min-width: var(--size-action-min);
      flex: 1 1 auto;
    }
    @media (max-width: 520px) {
      .dialog-host {
        padding: 0;
        place-items: end stretch;
      }
      .dialog {
        width: 100%;
        max-height: 92dvh;
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        padding: var(--space-5) var(--space-4);
      }
      .dialog__actions {
        flex-direction: column-reverse;
      }
    }
  `
})
export class DialogComponent implements AfterViewInit, OnDestroy {
  readonly heading = input.required<string>();
  readonly icon = input<IconName | null>(null);
  readonly tone = input<'default' | 'warn' | 'crit' | 'alarm'>('default');
  readonly role = input<'dialog' | 'alertdialog'>('dialog');
  // Darf per Esc, Schliessen-Knopf und Klick daneben geschlossen werden (nicht bei Alarmen).
  readonly closable = input(true);
  // Klick daneben schliesst nicht, wenn sonst eine Eingabe verloren ginge (Esc und Abbrechen gehen weiter).
  readonly backdropClose = input(true);
  readonly close = output<void>();

  readonly titleId = `dialog-title-${++nextId}`;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly previousFocus = document.activeElement as HTMLElement | null;

  ngAfterViewInit(): void {
    // Erst das markierte Element, sonst das erste Eingabefeld, sonst der Dialog selbst.
    const panel = this.panel().nativeElement;
    const preferred =
      panel.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
      panel.querySelector<HTMLElement>('.dialog__body input:not([disabled]), .dialog__body select, .dialog__body textarea');
    queueMicrotask(() => (preferred ?? panel).focus());
  }

  ngOnDestroy(): void {
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus();
    }
  }

  onBackdrop(): void {
    if (this.closable() && this.backdropClose()) {
      this.close.emit();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.closable()) {
        event.stopPropagation();
        this.close.emit();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = Array.from(this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
