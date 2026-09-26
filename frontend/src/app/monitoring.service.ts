import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, NgZone, signal } from '@angular/core';
import { environment } from '../environments/environment';
import { ClockService } from './clock.service';
import {
  elapsedSeconds,
  normalizeTrupp,
  pressureCheckDue,
  pressureCheckFraction,
  sortTrupps
} from './crew-status';
import { Einsatz, Trupp } from './models';
import { RealtimeService } from './realtime.service';
import { TranslationService } from './translation.service';

export type AlarmType = 'warn' | 'max';
export type ToastType = 'warn' | 'max';

export interface AlarmState {
  trupp: Trupp;
  type: AlarmType;
  // Bestaetigen erst nach kurzer Verzoegerung, damit ein Tipp, der fuer einen anderen Dialog gedacht war,
  // den gerade erscheinenden Alarm nicht versehentlich bestaetigt.
  ackReady: boolean;
}

export interface Toast {
  id: number;
  text: string;
  type: ToastType;
}

// Ueberwacht den aktiven Einsatz app-weit – unabhaengig davon, welche Seite gerade offen ist.
// Frueher lebte diese Logik im Dashboard; beim Wechsel in die Einstellungen liefen dann keine Alarme.
@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeService);
  private readonly clock = inject(ClockService);
  private readonly i18n = inject(TranslationService);
  private readonly zone = inject(NgZone);
  private readonly baseUrl = environment.apiBaseUrl;

  readonly einsatz = signal<Einsatz | null>(null);
  readonly trupps = signal<Trupp[]>([]);
  readonly now = signal(Date.now());
  readonly alarm = signal<AlarmState | null>(null);
  readonly toasts = signal<Toast[]>([]);
  // Browser blockieren Ton bis zur ersten Beruehrung; waehrend eines Einsatzes wird dann ein Hinweis angezeigt.
  readonly audioLocked = signal(true);
  // Solange ein Einsatz laeuft, darf die automatische Abmeldung nicht greifen.
  readonly active = computed(() => this.einsatz() !== null);

  private running = false;
  private timerId?: number;
  private unsubscribeRealtime?: () => void;
  private toastId = 0;
  private notifiedWarn = new Set<string>();
  private notifiedMax = new Set<string>();
  private lastWarnAlert: Record<string, number> = {};
  private lastMaxAlert: Record<string, number> = {};
  private remindedPressureChecks = new Set<string>();
  private audioCtx: AudioContext | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  private readonly onUserGesture = () => this.unlockAudio();
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.updateWakeLock();
    }
  };

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.realtime.start();
    this.unsubscribeRealtime = this.realtime.onUpdate((type) => {
      if (type === 'einsatz' || type === 'trupp' || type === 'druck') {
        this.refresh();
      }
    });
    document.addEventListener('pointerdown', this.onUserGesture);
    document.addEventListener('keydown', this.onUserGesture);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.now.set(this.clock.now());
    this.timerId = window.setInterval(() => {
      this.zone.run(() => {
        this.now.set(this.clock.now());
        this.audioLocked.set(!this.audioCtx || this.audioCtx.state !== 'running');
        this.checkThresholds();
      });
    }, 1000);
    this.refresh();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    window.clearInterval(this.timerId);
    this.unsubscribeRealtime?.();
    document.removeEventListener('pointerdown', this.onUserGesture);
    document.removeEventListener('keydown', this.onUserGesture);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.releaseWakeLock();
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.einsatz.set(null);
    this.trupps.set([]);
    this.alarm.set(null);
    this.toasts.set([]);
    this.notifiedWarn.clear();
    this.notifiedMax.clear();
    this.lastWarnAlert = {};
    this.lastMaxAlert = {};
    this.remindedPressureChecks.clear();
  }

  refresh(): void {
    this.http.get<Einsatz[]>(`${this.baseUrl}/einsaetze/aktiv`).subscribe((list) => {
      this.einsatz.set(list[0] ?? null);
      this.updateWakeLock();
      if (this.einsatz()) {
        this.loadTrupps();
      } else {
        this.trupps.set([]);
      }
    });
  }

  loadTrupps(): void {
    const einsatz = this.einsatz();
    if (!einsatz) {
      return;
    }
    this.http.get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`).subscribe((list) => {
      this.trupps.set(sortTrupps(list.map(normalizeTrupp)));
      this.checkThresholds();
    });
  }

  notify(text: string, type: ToastType): void {
    const id = ++this.toastId;
    this.toasts.update((list) => [...list, { id, text, type }]);
    window.setTimeout(() => this.toasts.update((list) => list.filter((t) => t.id !== id)), 6000);
  }

  acknowledgeAlarm(): void {
    const alarm = this.alarm();
    if (!alarm?.ackReady) {
      return;
    }
    const { trupp, type } = alarm;
    if (type === 'warn') {
      trupp.warnAcked = true;
    } else {
      trupp.maxAcked = true;
    }
    this.alarm.set(null);
    // Erst nach dem Speichern neu laden, sonst ueberschreibt der alte Serverstand die Quittierung.
    this.http.post(`${this.baseUrl}/trupps/${trupp.id}/events`, { typ: `${type}_ack` }).subscribe({
      next: () => this.loadTrupps(),
      error: (err) => this.notify(err?.error?.error ?? this.i18n.t('dashboard.actionFailed'), 'warn')
    });
  }

  // Ein gemeinsamer AudioContext, freigeschaltet bei der ersten Beruehrung/Taste. Neue Contexts ohne
  // Nutzerinteraktion bleiben in Browsern stumm – genau dann, wenn der Alarm kommt.
  unlockAudio(): void {
    try {
      this.audioCtx ??= new AudioContext();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => undefined);
      }
    } catch {
      // kein Audio verfuegbar
    }
  }

  private checkThresholds(): void {
    const now = this.now();
    for (const trupp of this.trupps()) {
      if (trupp.endzeit) {
        continue;
      }
      this.remindPressureCheck(trupp, now);
      const elapsedMin = Math.floor(elapsedSeconds(trupp, now) / 60);
      if (elapsedMin >= trupp.maxzeitMin && !trupp.maxAcked) {
        if (this.shouldAlert(this.lastMaxAlert, trupp.id, now, 15000)) {
          this.notify(this.i18n.t('dashboard.maxReachedCrew', { name: trupp.bezeichnung }), 'max');
          this.playBeep(4, true);
          this.vibrate([250, 120, 250, 120, 250]);
          this.logEvent(trupp, 'max');
          this.openAlarm(trupp, 'max');
        }
      } else if (elapsedMin >= trupp.warnzeitMin && !trupp.warnAcked) {
        if (this.shouldAlert(this.lastWarnAlert, trupp.id, now, 30000)) {
          this.notify(this.i18n.t('dashboard.warnReachedCrew', { name: trupp.bezeichnung }), 'warn');
          this.playBeep(2);
          this.vibrate([180, 120, 180]);
          this.logEvent(trupp, 'warn');
          this.openAlarm(trupp, 'warn');
        }
      }
    }
  }

  private remindPressureCheck(trupp: Trupp, now: number): void {
    const stage = pressureCheckDue(trupp, now);
    if (!stage) {
      return;
    }
    const key = `${trupp.id}:${stage}`;
    if (this.remindedPressureChecks.has(key)) {
      return;
    }
    this.remindedPressureChecks.add(key);
    this.notify(
      this.i18n.t('dashboard.pressureCheckDueCrew', {
        name: trupp.bezeichnung,
        fraction: pressureCheckFraction(stage)
      }),
      'warn'
    );
    this.playBeep(1);
  }

  private openAlarm(trupp: Trupp, type: AlarmType): void {
    if (this.alarm()) {
      return;
    }
    this.alarm.set({ trupp, type, ackReady: false });
    window.setTimeout(() => {
      const current = this.alarm();
      if (current && current.trupp.id === trupp.id && current.type === type) {
        this.alarm.set({ ...current, ackReady: true });
      }
    }, 1500);
  }

  // Protokolliert das erste Ausloesen je Trupp und Typ; Wiederholungen des Alarms erzeugen keine weiteren Eintraege.
  private logEvent(trupp: Trupp, type: AlarmType): void {
    const notified = type === 'warn' ? this.notifiedWarn : this.notifiedMax;
    if (notified.has(trupp.id)) {
      return;
    }
    notified.add(trupp.id);
    this.http.post(`${this.baseUrl}/trupps/${trupp.id}/events`, { typ: type }).subscribe({
      error: () => notified.delete(trupp.id)
    });
  }

  private shouldAlert(store: Record<string, number>, id: string, now: number, intervalMs: number): boolean {
    const last = store[id] ?? 0;
    if (now - last < intervalMs) {
      return false;
    }
    store[id] = now;
    return true;
  }

  private vibrate(pattern: number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // ignore
    }
  }

  // Deutlich hoerbarer Signalton: warn = 2 Toene, max = 4 Toene im Wechsel, Erinnerung = 1 Ton.
  private playBeep(times: number, alternate = false): void {
    try {
      this.audioCtx ??= new AudioContext();
      const ctx = this.audioCtx;
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => undefined);
        return;
      }
      const toneSec = 0.3;
      const gapSec = 0.15;
      for (let i = 0; i < times; i += 1) {
        const start = ctx.currentTime + i * (toneSec + gapSec);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = alternate && i % 2 === 1 ? 1320 : 880;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.setValueAtTime(0, start + toneSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + toneSec);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      }
    } catch {
      // ignore audio errors
    }
  }

  // Bildschirm waehrend eines Einsatzes wach halten, sonst schaltet das Tablet ab und Alarme bleiben ungesehen.
  private async updateWakeLock(): Promise<void> {
    if (!this.einsatz()) {
      this.releaseWakeLock();
      return;
    }
    if (this.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
      return;
    }
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
    } catch {
      // z. B. Energiesparmodus; Anzeige laeuft trotzdem weiter
    }
  }

  private releaseWakeLock(): void {
    this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }
}
