import { Component, effect, ElementRef, inject, ViewChild } from '@angular/core';
import { MonitoringService } from './monitoring.service';
import { TranslationService } from './translation.service';

// Alarm-Dialog, Einblendungen und Ton-Hinweis – eingebunden in der App-Huelle, damit Alarme auf jeder Seite
// erscheinen (auch in den Einstellungen).
@Component({
  selector: 'app-alarm-overlay',
  template: `
    @if (monitoring.active() && monitoring.audioLocked()) {
      <div class="audio-hint audio-hint--floating" role="alert">
        <span>{{ i18n.t('dashboard.audioBlocked') }}</span>
        <button class="primary" type="button" (click)="monitoring.unlockAudio()">{{ i18n.t('dashboard.audioEnable') }}</button>
      </div>
    }

    @if (monitoring.toasts().length) {
      <div class="toast-stack">
        @for (t of monitoring.toasts(); track t.id) {
          <div class="toast" [class.toast--warn]="t.type === 'warn'" [class.toast--max]="t.type === 'max'">{{ t.text }}</div>
        }
      </div>
    }

    @if (monitoring.alarm(); as alarm) {
      <div class="modal">
        <div class="modal__backdrop"></div>
        <div
          #alarmPanel
          tabindex="-1"
          class="modal__panel"
          [class.modal__panel--max]="alarm.type === 'max'"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alarm-title"
        >
          <h3 id="alarm-title">{{ alarm.type === 'max' ? i18n.t('dashboard.maxReached') : i18n.t('dashboard.warnReached') }}</h3>
          <p class="alarm-crew">{{ alarm.trupp.bezeichnung }}</p>
          <p class="muted">{{ i18n.t('dashboard.alarmAckHint') }}</p>
          <div class="modal__actions">
            <button class="primary" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.acknowledgeAlarm()">
              {{ i18n.t('dashboard.acknowledge') }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class AlarmOverlayComponent {
  readonly monitoring = inject(MonitoringService);
  readonly i18n = inject(TranslationService);
  @ViewChild('alarmPanel') alarmPanel?: ElementRef<HTMLElement>;
  private lastAlarmKey: string | null = null;

  constructor() {
    // Fokus auf den Dialog statt auf den Button: Enter aus einem anderen Eingabefeld bestaetigt nicht.
    effect(() => {
      const alarm = this.monitoring.alarm();
      const key = alarm ? `${alarm.trupp.id}:${alarm.type}` : null;
      if (key && key !== this.lastAlarmKey) {
        window.setTimeout(() => this.alarmPanel?.nativeElement.focus(), 0);
      }
      this.lastAlarmKey = key;
    });
  }
}
