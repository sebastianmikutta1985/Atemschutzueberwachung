import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { AlarmState, AlarmType, maydayKey, MonitoringService } from './monitoring.service';
import { OutboxItem } from './outbox.service';
import { TranslationService } from './translation.service';
import { BannerComponent } from './ui/banner.component';
import { ButtonComponent } from './ui/button.component';
import { DialogComponent } from './ui/dialog.component';
import { TranslatePipe } from './ui/translate.pipe';

// Alarm-Dialog, Einblendungen und Ton-Hinweis – eingebunden in der App-Huelle, damit Alarme auf jeder Seite
// erscheinen (auch in den Einstellungen).
@Component({
  selector: 'app-alarm-overlay',
  imports: [DatePipe, FormsModule, BannerComponent, ButtonComponent, DialogComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Oben, im Fluss und beim Scrollen sichtbar: offene Maydays und Verbindungsverlust -->
    @if (monitoring.maydays().length || showConnectionLost()) {
      <div class="overlay-top">
        @for (t of monitoring.maydays(); track t.id) {
          <app-banner class="mayday-banner" tone="mayday">
            <p class="overlay-line">
              <strong class="overlay-strong">MAYDAY · {{ t.bezeichnung }}</strong>
              <span>{{ 'mayday.since' | t: { time: (t.maydaySeit | date: 'HH:mm:ss') ?? '' } }}</span>
              @if (t.maydayPosition) {
                <span>{{ 'mayday.position' | t }}: {{ t.maydayPosition }}</span>
              }
              @if (t.maydayRestdruck !== null && t.maydayRestdruck !== undefined) {
                <span>{{ 'mayday.pressure' | t }}: {{ t.maydayRestdruck }} bar</span>
              }
              @if (t.maydayFunkspruch) {
                <span>„{{ t.maydayFunkspruch }}“</span>
              }
              @if (monitoring.maydayNotSent(t.id)) {
                <span class="overlay-flag">{{ 'mayday.notSent' | t }}</span>
              }
            </p>
            <div banner-actions class="overlay-actions overlay-actions--on-solid">
              <button appButton size="sm" type="button" (click)="monitoring.openMaydayDialog(t, 'info')">{{ 'mayday.addInfo' | t }}</button>
              <button appButton size="sm" type="button" (click)="monitoring.openMaydayDialog(t, 'ende')">{{ 'mayday.end' | t }}</button>
            </div>
          </app-banner>
        }
        @if (showConnectionLost()) {
          <app-banner class="connection-lost" tone="crit" icon="offline">
            <p class="overlay-line">{{ 'common.connectionLost' | t }}</p>
            @if (monitoring.snapshotFrom(); as from) {
              <p class="overlay-line">{{ 'common.snapshotFrom' | t: { time: (from | date: 'HH:mm:ss') ?? '' } }}</p>
            }
          </app-banner>
        }
      </div>
    }

    <!-- Unten rechts gestapelt statt einzeln positioniert, damit sich nichts ueberdeckt -->
    <div class="overlay-bottom" aria-live="polite">
      @for (t of recentToasts(); track t.id) {
        <app-banner class="toast" [tone]="t.type === 'max' ? 'crit' : 'warn'">
          <p class="overlay-line">{{ t.text }}</p>
        </app-banner>
      }

      @if (monitoring.outbox.failed().length) {
        <app-banner class="outbox-failed" tone="crit">
          <p class="overlay-line"><strong>{{ 'outbox.failedTitle' | t }}</strong></p>
          @for (item of monitoring.outbox.failed(); track item.id) {
            <div class="overlay-item">
              <div>
                <div>{{ describe(item) }} · <time>{{ item.zeit | date: 'HH:mm:ss' }}</time></div>
                <div class="overlay-sub">{{ item.error }}</div>
              </div>
              <button appButton size="sm" variant="ghost" type="button" (click)="monitoring.outbox.discard(item.id)">{{ 'outbox.discard' | t }}</button>
            </div>
          }
        </app-banner>
      }

      @if (monitoring.outbox.waiting().length) {
        <app-banner class="outbox-waiting" tone="warn" icon="pending">
          <p class="overlay-line">{{ 'outbox.waiting' | t: { count: monitoring.outbox.waiting().length } }}</p>
        </app-banner>
      }

      @if (updateReady()) {
        <app-banner class="update-hint" tone="info" icon="refresh">
          <p class="overlay-line">{{ 'common.updateAvailable' | t }}</p>
          <div banner-actions>
            <button appButton size="sm" variant="primary" type="button" (click)="reload()">{{ 'common.reload' | t }}</button>
          </div>
        </app-banner>
      }

      @if (monitoring.active() && monitoring.audioLocked()) {
        <app-banner class="audio-hint" tone="warn" icon="volume">
          <p class="overlay-line">{{ 'dashboard.audioBlocked' | t }}</p>
          <div banner-actions>
            <button appButton size="sm" variant="primary" type="button" (click)="monitoring.unlockAudio()">{{ 'dashboard.audioEnable' | t }}</button>
          </div>
        </app-banner>
      }
    </div>

    <!-- Mayday-Vollbild: je Mayday neu aufgebaut, damit der Fokus wieder auf dem Dialog liegt -->
    @for (t of unseenMaydayList(); track maydayKey(t)) {
      <app-dialog class="modal--mayday" heading="MAYDAY" icon="alert-octagon" tone="alarm" role="alertdialog" [closable]="false">
        <div class="alarm-body">
          <p class="alarm-crew">{{ t.bezeichnung }}</p>
          <p>{{ t.person1Name }} · {{ t.person2Name }}</p>
          <p class="alarm-meta">
            {{ 'mayday.since' | t: { time: (t.maydaySeit | date: 'HH:mm:ss') ?? '' } }}
            @if (t.maydayPosition) {
              · {{ 'mayday.position' | t }}: {{ t.maydayPosition }}
            }
            @if (t.maydayRestdruck !== null && t.maydayRestdruck !== undefined) {
              · {{ 'mayday.pressure' | t }}: {{ t.maydayRestdruck }} bar
            }
          </p>
          <p class="alarm-meta">{{ 'mayday.radioReminder' | t }}</p>
        </div>
        <div dialog-actions class="dialog__actions">
          <button appButton variant="danger" size="lg" type="button" [disabled]="!maydaySeenReady()" (click)="monitoring.markMaydaySeen(t)">
            {{ 'mayday.seen' | t }}
          </button>
        </div>
      </app-dialog>
    }

    @if (monitoring.maydayDialog(); as d) {
      <app-dialog
        [heading]="(d.mode === 'ende' ? 'mayday.endTitle' : 'mayday.infoTitle') | t: { name: d.truppName }"
        [icon]="d.mode === 'ende' ? 'check-circle' : 'alert-octagon'"
        [tone]="d.mode === 'ende' ? 'crit' : 'default'"
        [backdropClose]="false"
        (close)="monitoring.closeMaydayDialog()"
      >
        <form (ngSubmit)="monitoring.saveMaydayDialog()">
          @if (d.mode === 'ende') {
            <label>
              {{ 'mayday.endNote' | t }}
              <textarea name="maydayNote" rows="3" maxlength="500" [(ngModel)]="d.note"></textarea>
            </label>
          } @else {
            <p class="muted">{{ 'mayday.infoHint' | t }}</p>
            <label>
              {{ 'mayday.position' | t }}
              <input name="maydayPosition" maxlength="200" [(ngModel)]="d.position" />
            </label>
            <label>
              {{ 'mayday.pressure' | t }} (bar)
              <input name="maydayRestdruck" type="number" inputmode="numeric" min="0" max="400" [(ngModel)]="d.restdruck" />
            </label>
            <label>
              {{ 'mayday.radio' | t }}
              <textarea name="maydayFunkspruch" rows="2" maxlength="500" [(ngModel)]="d.funkspruch"></textarea>
            </label>
          }
          @if (d.error) {
            <div class="form-error" role="alert">{{ d.error }}</div>
          }
          <div class="dialog__actions">
            <button appButton variant="ghost" type="button" (click)="monitoring.closeMaydayDialog()">{{ 'common.cancel' | t }}</button>
            <button appButton [variant]="d.mode === 'ende' ? 'danger' : 'primary'" type="submit" [disabled]="d.saving">
              {{ (d.mode === 'ende' ? 'mayday.end' : 'common.save') | t }}
            </button>
          </div>
        </form>
      </app-dialog>
    }

    <!-- Warn-/Maximalzeit- und Rueckzug-Alarm erst, wenn kein ungesehener Mayday ansteht. Je Alarm neu aufgebaut:
         der Fokus liegt auf dem Dialog statt auf dem Button, damit Enter aus einem anderen Feld nicht bestaetigt. -->
    @for (alarm of alarmList(); track alarm.trupp.id + ':' + alarm.type) {
      <app-dialog
        [heading]="alarmTitle(alarm.type)"
        [icon]="alarm.type === 'warn' ? 'alert-triangle' : 'alert-circle'"
        [tone]="alarm.type === 'warn' ? 'warn' : 'alarm'"
        role="alertdialog"
        [closable]="false"
        class="alarm-dialog"
      >
        <div class="alarm-body">
          <p class="alarm-crew">{{ alarm.trupp.bezeichnung }}</p>
          @if (alarm.detail) {
            <p class="alarm-detail">{{ alarm.detail }}</p>
          }
          <p class="alarm-meta">{{ 'dashboard.alarmAckHint' | t }}</p>
        </div>
        <div dialog-actions class="dialog__actions">
          @if (alarm.type === 'rueckzug') {
            <button appButton variant="ghost" size="lg" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.acknowledgeAlarm()">
              {{ 'dashboard.acknowledge' | t }}
            </button>
            <button appButton variant="warn" size="lg" icon="arrow-return" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.retreatFromAlarm()">
              {{ 'crewState.step_rueckweg' | t }}
            </button>
          } @else {
            <button appButton variant="primary" size="lg" type="button" [disabled]="!alarm.ackReady" (click)="monitoring.acknowledgeAlarm()">
              {{ 'dashboard.acknowledge' | t }}
            </button>
          }
        </div>
      </app-dialog>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .overlay-top {
      position: sticky;
      top: 0;
      z-index: var(--z-banner);
      display: grid;
    }
    .overlay-top app-banner {
      border-radius: 0;
      border-width: 0 0 var(--border-w) 0;
    }
    .mayday-banner {
      animation: overlay-flash var(--dur-pulse) ease-in-out infinite;
    }
    /* Blinkt mit einem Rand in Textfarbe: die Flaeche bleibt gleich, damit der Text lesbar bleibt */
    @keyframes overlay-flash {
      50% {
        box-shadow: inset 0 0 0 var(--space-1) var(--status-crit-on);
      }
    }
    .overlay-bottom {
      position: fixed;
      right: var(--space-4);
      bottom: var(--space-4);
      left: var(--space-4);
      /* Unter Dialogen: Hinweise duerfen nie einen Alarm oder eine Eingabe verdecken */
      z-index: var(--z-banner);
      display: grid;
      justify-items: end;
      gap: var(--space-2);
      pointer-events: none;
    }
    .overlay-bottom app-banner {
      width: min(100%, var(--dialog-max));
      box-shadow: var(--shadow-2);
      pointer-events: auto;
    }
    .overlay-line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      margin: 0;
    }
    .overlay-strong {
      font-weight: var(--fw-heavy);
      letter-spacing: var(--tracking-caps);
    }
    .overlay-flag {
      padding: 0 var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--status-crit-on);
      color: var(--status-crit-solid);
      font-weight: var(--fw-heavy);
    }
    .overlay-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--touch-gap);
    }
    /* Buttons auf der roten Mayday-Flaeche: Umriss in Textfarbe */
    .overlay-actions--on-solid button {
      --btn-bg: transparent;
      --btn-fg: var(--status-crit-on);
      --btn-border: var(--status-crit-on);
    }
    .overlay-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);
    }
    .overlay-sub {
      font-size: var(--fs-sm);
      font-weight: var(--fw-regular);
    }
    .alarm-body {
      display: grid;
      gap: var(--space-2);
    }
    .alarm-body p {
      margin: 0;
    }
    .alarm-crew {
      font-size: var(--fs-3xl);
      font-weight: var(--fw-heavy);
      line-height: var(--lh-tight);
    }
    .alarm-detail {
      font-size: var(--fs-lg);
      font-weight: var(--fw-bold);
    }
    .alarm-meta {
      color: var(--text-muted);
      font-weight: var(--fw-semibold);
    }
    /* Schmal: beide Mayday-Knoepfe gleich breit ueber die ganze Zeile, wie auf der Karte */
    @media (max-width: 640px) {
      .overlay-actions {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 1fr;
        width: 100%;
      }
    }
    @media (max-width: 520px) {
      .overlay-bottom {
        right: var(--space-2);
        bottom: var(--space-2);
        left: var(--space-2);
      }
    }
  `
})
export class AlarmOverlayComponent {
  readonly monitoring = inject(MonitoringService);
  readonly i18n = inject(TranslationService);
  readonly maydayKey = maydayKey;
  // "Gesehen" erst nach kurzer Verzoegerung, damit ein Tipp fuer etwas anderes den Ton nicht versehentlich abstellt.
  readonly maydaySeenReady = signal(false);
  private lastMaydayKey: string | null = null;
  // Neue App-Version geladen (Service Worker). Kein automatisches Neuladen: das wuerde laufende Eingaben verwerfen.
  readonly updateReady = signal(false);

  // Nur die neuesten Meldungen zeigen; aeltere verschwinden ohnehin nach kurzer Zeit.
  readonly recentToasts = computed(() => this.monitoring.toasts().slice(-3));
  readonly showConnectionLost = computed(
    () => this.monitoring.running() && (this.monitoring.connectionLost() || this.monitoring.snapshotFrom() !== null)
  );
  // Als Liste, damit @for mit track den Dialog je Mayday bzw. Alarm neu aufbaut (Fokus, Verzoegerung).
  readonly unseenMaydayList = computed(() => {
    const t = this.monitoring.unseenMayday();
    return t ? [t] : [];
  });
  readonly alarmList = computed<AlarmState[]>(() => {
    const alarm = this.monitoring.alarm();
    return !this.monitoring.unseenMayday() && alarm ? [alarm] : [];
  });

  constructor() {
    const updates = inject(SwUpdate, { optional: true });
    if (updates?.isEnabled) {
      updates.versionUpdates
        .pipe(filter((event) => event.type === 'VERSION_READY'))
        .subscribe(() => this.updateReady.set(true));
    }

    effect(() => {
      const t = this.monitoring.unseenMayday();
      const key = t ? maydayKey(t) : null;
      if (key && key !== this.lastMaydayKey) {
        this.maydaySeenReady.set(false);
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
