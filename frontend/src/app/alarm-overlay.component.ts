import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, effect, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { AlarmType, maydayKey, MonitoringService } from './monitoring.service';
import { OutboxItem } from './outbox.service';
import { TranslationService } from './translation.service';

// Alarm-Dialog, Einblendungen und Ton-Hinweis – eingebunden in der App-Huelle, damit Alarme auf jeder Seite
// erscheinen (auch in den Einstellungen).
@Component({
  selector: 'app-alarm-overlay',
  imports: [DatePipe, FormsModule],
  template: `
    <!-- Offene Maydays: auf jeder Seite oben, bis "Mayday beendet" erfasst ist -->
    @if (monitoring.maydays().length) {
      <div class="mayday-banner" role="alert">
        @for (t of monitoring.maydays(); track t.id) {
          <div class="mayday-banner__item">
            <div class="mayday-banner__text">
              <strong>MAYDAY · {{ t.bezeichnung }}</strong>
              <span>{{ i18n.t('mayday.since', { time: (t.maydaySeit | date: 'HH:mm:ss') ?? '' }) }}</span>
              @if (t.maydayPosition) {
                <span>{{ i18n.t('mayday.position') }}: {{ t.maydayPosition }}</span>
              }
              @if (t.maydayRestdruck !== null && t.maydayRestdruck !== undefined) {
                <span>{{ i18n.t('mayday.pressure') }}: {{ t.maydayRestdruck }} bar</span>
              }
              @if (t.maydayFunkspruch) {
                <span>„{{ t.maydayFunkspruch }}“</span>
              }
              @if (monitoring.maydayNotSent(t.id)) {
                <span class="mayday-banner__offline">{{ i18n.t('mayday.notSent') }}</span>
              }
            </div>
            <div class="mayday-banner__actions">
              <button class="ghost" type="button" (click)="monitoring.openMaydayDialog(t, 'info')">{{ i18n.t('mayday.addInfo') }}</button>
              <button class="ghost" type="button" (click)="monitoring.openMaydayDialog(t, 'ende')">{{ i18n.t('mayday.end') }}</button>
            </div>
          </div>
        }
      </div>
    }

    @if (monitoring.running() && (monitoring.connectionLost() || monitoring.snapshotFrom())) {
      <div class="connection-lost" role="alert">
        {{ i18n.t('common.connectionLost') }}
        @if (monitoring.snapshotFrom(); as from) {
          <div>{{ i18n.t('common.snapshotFrom', { time: (from | date: 'HH:mm:ss') ?? '' }) }}</div>
        }
      </div>
    }

    @if (monitoring.outbox.waiting().length) {
      <div class="outbox-waiting" role="status">
        {{ i18n.t('outbox.waiting', { count: monitoring.outbox.waiting().length }) }}
      </div>
    }

    @if (monitoring.outbox.failed().length) {
      <div class="outbox-failed" role="alert">
        <strong>{{ i18n.t('outbox.failedTitle') }}</strong>
        @for (item of monitoring.outbox.failed(); track item.id) {
          <div class="outbox-failed__item">
            <div>
              <div>{{ describe(item) }} · {{ item.zeit | date: 'HH:mm:ss' }}</div>
              <div class="muted">{{ item.error }}</div>
            </div>
            <button class="ghost" type="button" (click)="monitoring.outbox.discard(item.id)">{{ i18n.t('outbox.discard') }}</button>
          </div>
        }
      </div>
    }

    @if (updateReady()) {
      <div class="update-hint" role="status">
        <span>{{ i18n.t('common.updateAvailable') }}</span>
        <button class="ghost" type="button" (click)="reload()">{{ i18n.t('common.reload') }}</button>
      </div>
    }

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

    @if (monitoring.unseenMayday(); as t) {
      <div class="modal modal--mayday">
        <div class="modal__backdrop"></div>
        <div #maydayPanel tabindex="-1" class="modal__panel modal__panel--mayday" role="alertdialog" aria-modal="true" aria-labelledby="mayday-title">
          <h3 id="mayday-title" class="mayday-title">MAYDAY</h3>
          <p class="alarm-crew">{{ t.bezeichnung }}</p>
          <p>{{ t.person1Name }} · {{ t.person2Name }}</p>
          <p class="muted">
            {{ i18n.t('mayday.since', { time: (t.maydaySeit | date: 'HH:mm:ss') ?? '' }) }}
            @if (t.maydayPosition) { · {{ i18n.t('mayday.position') }}: {{ t.maydayPosition }} }
            @if (t.maydayRestdruck !== null && t.maydayRestdruck !== undefined) { · {{ i18n.t('mayday.pressure') }}: {{ t.maydayRestdruck }} bar }
          </p>
          <p class="muted">{{ i18n.t('mayday.radioReminder') }}</p>
          <div class="modal__actions">
            <button class="danger" type="button" [disabled]="!maydaySeenReady()" (click)="monitoring.markMaydaySeen(t)">
              {{ i18n.t('mayday.seen') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (monitoring.maydayDialog(); as d) {
      <div class="modal">
        <div class="modal__backdrop"></div>
        <form class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="mayday-dialog-title" (ngSubmit)="monitoring.saveMaydayDialog()">
          <h3 id="mayday-dialog-title">
            {{ d.mode === 'ende' ? i18n.t('mayday.endTitle', { name: d.truppName }) : i18n.t('mayday.infoTitle', { name: d.truppName }) }}
          </h3>
          @if (d.mode === 'ende') {
            <label>
              {{ i18n.t('mayday.endNote') }}
              <textarea name="maydayNote" rows="3" maxlength="500" [(ngModel)]="d.note"></textarea>
            </label>
          } @else {
            <p class="muted">{{ i18n.t('mayday.infoHint') }}</p>
            <label>
              {{ i18n.t('mayday.position') }}
              <input name="maydayPosition" maxlength="200" [(ngModel)]="d.position" />
            </label>
            <label>
              {{ i18n.t('mayday.pressure') }} (bar)
              <input name="maydayRestdruck" type="number" inputmode="numeric" min="0" max="400" [(ngModel)]="d.restdruck" />
            </label>
            <label>
              {{ i18n.t('mayday.radio') }}
              <textarea name="maydayFunkspruch" rows="2" maxlength="500" [(ngModel)]="d.funkspruch"></textarea>
            </label>
          }
          @if (d.error) {
            <div class="form-error">{{ d.error }}</div>
          }
          <div class="modal__actions">
            <button class="ghost" type="button" (click)="monitoring.closeMaydayDialog()">{{ i18n.t('common.cancel') }}</button>
            <button [class]="d.mode === 'ende' ? 'danger' : 'primary'" type="submit" [disabled]="d.saving">
              {{ d.mode === 'ende' ? i18n.t('mayday.end') : i18n.t('common.save') }}
            </button>
          </div>
        </form>
      </div>
    }

    <!-- Warn-/Maximalzeit- und Rueckzug-Alarm erst, wenn kein ungesehener Mayday ansteht -->
    @if (!monitoring.unseenMayday() && monitoring.alarm(); as alarm) {
      <div class="modal">
        <div class="modal__backdrop"></div>
        <div
          #alarmPanel
          tabindex="-1"
          class="modal__panel"
          [class.modal__panel--max]="alarm.type !== 'warn'"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alarm-title"
        >
          <h3 id="alarm-title">{{ alarmTitle(alarm.type) }}</h3>
          <p class="alarm-crew">{{ alarm.trupp.bezeichnung }}</p>
          @if (alarm.detail) {
            <p class="alarm-detail">{{ alarm.detail }}</p>
          }
          <p class="muted">{{ i18n.t('dashboard.alarmAckHint') }}</p>
          <div class="modal__actions">
            @if (alarm.type === 'rueckzug') {
              <button class="ghost" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.acknowledgeAlarm()">
                {{ i18n.t('dashboard.acknowledge') }}
              </button>
              <button class="primary" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.retreatFromAlarm()">
                {{ i18n.t('crewState.step_rueckweg') }}
              </button>
            } @else {
              <button class="primary" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.acknowledgeAlarm()">
                {{ i18n.t('dashboard.acknowledge') }}
              </button>
            }
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
  @ViewChild('maydayPanel') maydayPanel?: ElementRef<HTMLElement>;
  // "Gesehen" erst nach kurzer Verzoegerung, damit ein Tipp fuer etwas anderes den Ton nicht versehentlich abstellt.
  readonly maydaySeenReady = signal(false);
  private lastMaydayKey: string | null = null;
  private lastAlarmKey: string | null = null;
  // Neue App-Version geladen (Service Worker). Kein automatisches Neuladen: das wuerde laufende Eingaben verwerfen.
  readonly updateReady = signal(false);

  constructor() {
    const updates = inject(SwUpdate, { optional: true });
    if (updates?.isEnabled) {
      updates.versionUpdates
        .pipe(filter((event) => event.type === 'VERSION_READY'))
        .subscribe(() => this.updateReady.set(true));
    }

    // Fokus auf den Dialog statt auf den Button: Enter aus einem anderen Eingabefeld bestaetigt nicht.
    effect(() => {
      const alarm = this.monitoring.alarm();
      const key = alarm ? `${alarm.trupp.id}:${alarm.type}` : null;
      if (key && key !== this.lastAlarmKey) {
        window.setTimeout(() => this.alarmPanel?.nativeElement.focus(), 0);
      }
      this.lastAlarmKey = key;
    });

    effect(() => {
      const t = this.monitoring.unseenMayday();
      const key = t ? maydayKey(t) : null;
      if (key && key !== this.lastMaydayKey) {
        this.maydaySeenReady.set(false);
        window.setTimeout(() => this.maydayPanel?.nativeElement.focus(), 0);
        window.setTimeout(() => this.maydaySeenReady.set(true), 1000);
      }
      this.lastMaydayKey = key;
    });
  }

  alarmTitle(type: AlarmType): string {
    switch (type) {
      case 'max':
        return this.i18n.t('dashboard.maxReached');
      case 'rueckzug':
        return this.i18n.t('retreat.alarmTitle');
      default:
        return this.i18n.t('dashboard.warnReached');
    }
  }

  describe(item: OutboxItem): string {
    if (item.kind === 'druck') {
      return this.i18n.t('outbox.itemPressure', { crew: item.truppName, person: item.personName ?? '', value: item.druckBar ?? 0 });
    }
    if (item.kind === 'end') {
      return this.i18n.t('outbox.itemEnd', { crew: item.truppName });
    }
    if (item.kind === 'event' && item.typ?.startsWith('mayday')) {
      return this.i18n.t(`outbox.item_${item.typ}`, { crew: item.truppName });
    }
    if (item.kind === 'zustand') {
      return this.i18n.t('outbox.itemState', { crew: item.truppName, state: this.i18n.t(`crewState.step_${item.zustand}`) });
    }
    return this.i18n.t('outbox.itemEvent', { crew: item.truppName });
  }

  reload(): void {
    document.location.reload();
  }
}
