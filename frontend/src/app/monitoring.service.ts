import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, NgZone, signal } from '@angular/core';
import { environment } from '../environments/environment';
import { ClockService } from './clock.service';
import { AuthStore } from './auth.store';
import {
  applyPending,
  elapsedSeconds,
  normalizeTrupp,
  pressureCheckDue,
  pressureCheckFraction,
  sortTrupps
} from './crew-status';
import { Einsatz, Trupp } from './models';
import { OutboxService } from './outbox.service';
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
  readonly outbox = inject(OutboxService);
  private readonly baseUrl = environment.apiBaseUrl;

  readonly einsatz = signal<Einsatz | null>(null);
  // Stand des Servers; angezeigt wird er zusammen mit den noch nicht uebertragenen Eingaben.
  readonly serverTrupps = signal<Trupp[]>([]);
  readonly trupps = computed(() => sortTrupps(applyPending(this.serverTrupps(), this.outbox.pending())));
  readonly now = signal(Date.now());
  readonly alarm = signal<AlarmState | null>(null);
  readonly toasts = signal<Toast[]>([]);
  // Browser blockieren Ton bis zur ersten Beruehrung; waehrend eines Einsatzes wird dann ein Hinweis angezeigt.
  readonly audioLocked = signal(true);
  // Solange ein Einsatz laeuft, darf die automatische Abmeldung nicht greifen.
  readonly active = computed(() => this.einsatz() !== null);
  readonly running = signal(false);
  // Verbindung zum Server seit mindestens 5 s weg (kein Netz oder Live-Verbindung getrennt).
  readonly connectionLost = signal(false);
  // Gesetzt, wenn statt Serverdaten der lokale Schnappschuss angezeigt wird (Neuladen ohne Netz): Zeitpunkt des Stands.
  readonly snapshotFrom = signal<string | null>(null);
  private snapshotKey: string | null = null;

  private timerId?: number;
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  private unsubscribeSent?: () => void;
  private realtimeStatus: 'connected' | 'connecting' | 'disconnected' = 'connecting';
  private lostSince: number | null = null;
  private toastId = 0;
  private notifiedWarn = new Set<string>();
  private notifiedMax = new Set<string>();
  private lastWarnAlert: Record<string, number> = {};
  private lastMaxAlert: Record<string, number> = {};
  private remindedPressureChecks = new Set<string>();
  private audioCtx: AudioContext | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  private readonly onUserGesture = () => this.unlockAudio();
  // Nach der Wiederverbindung alles neu laden – Aenderungen anderer Geraete waehrend der Funkstille nachholen.
  private readonly onOnline = () => {
    this.realtime.start();
    this.outbox.flush();
    this.refresh();
  };
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.updateWakeLock();
    }
  };

  start(): void {
    if (this.running()) {
      return;
    }
    this.running.set(true);
    // Gespeicherte, noch nicht uebertragene Eingaben dieser Organisation laden und senden.
    const orgCode = AuthStore.load()?.orgCode;
    if (orgCode) {
      this.outbox.start(orgCode);
      this.snapshotKey = `crewtrace_snapshot_${orgCode.toLowerCase()}`;
    }
    this.unsubscribeSent = this.outbox.onSent(() => this.loadTrupps());
    this.realtime.start();
    this.realtimeStatus = this.realtime.status;
    this.unsubscribeStatus = this.realtime.onStatus((status) => {
      const wasDisconnected = this.realtimeStatus !== 'connected';
      this.realtimeStatus = status;
      if (status === 'connected' && wasDisconnected) {
        this.outbox.flush();
        this.refresh();
      }
    });
    window.addEventListener('online', this.onOnline);
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
        this.updateConnectionState();
        this.checkThresholds();
      });
    }, 1000);
    this.refresh();
  }

  stop(): void {
    if (!this.running()) {
      return;
    }
    this.running.set(false);
    window.clearInterval(this.timerId);
    this.unsubscribeRealtime?.();
    this.unsubscribeStatus?.();
    this.unsubscribeSent?.();
    this.outbox.stop();
    window.removeEventListener('online', this.onOnline);
    this.realtimeStatus = 'connecting';
    this.lostSince = null;
    this.connectionLost.set(false);
    document.removeEventListener('pointerdown', this.onUserGesture);
    document.removeEventListener('keydown', this.onUserGesture);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.releaseWakeLock();
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    // Schnappschuss enthaelt Namen der Geraetetraeger: beim Abmelden vom Geraet entfernen.
    this.writeSnapshot(null);
    this.snapshotKey = null;
    this.snapshotFrom.set(null);
    this.einsatz.set(null);
    this.serverTrupps.set([]);
    this.alarm.set(null);
    this.toasts.set([]);
    this.notifiedWarn.clear();
    this.notifiedMax.clear();
    this.lastWarnAlert = {};
    this.lastMaxAlert = {};
    this.remindedPressureChecks.clear();
  }

  refresh(): void {
    this.http.get<Einsatz[]>(`${this.baseUrl}/einsaetze/aktiv`).subscribe({
      next: (list) => {
        this.einsatz.set(list[0] ?? null);
        this.updateWakeLock();
        if (this.einsatz()) {
          this.loadTrupps();
        } else {
          this.serverTrupps.set([]);
          this.outbox.clearSent();
          this.snapshotFrom.set(null);
          this.writeSnapshot(null);
        }
      },
      error: (err) => this.restoreSnapshotIfOffline(err)
    });
  }

  loadTrupps(): void {
    const einsatz = this.einsatz();
    if (!einsatz) {
      return;
    }
    this.http.get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`).subscribe({
      next: (list) => {
        this.serverTrupps.set(list.map(normalizeTrupp));
        this.outbox.clearSent();
        this.snapshotFrom.set(null);
        this.writeSnapshot({ einsatz, trupps: list, savedAt: new Date(this.clock.now()).toISOString() });
        this.checkThresholds();
      },
      error: (err) => this.restoreSnapshotIfOffline(err)
    });
  }

  // Server nicht erreichbar und noch keine Daten (z. B. Neuladen ohne Netz): letzten bekannten Stand anzeigen,
  // damit Timer und Alarme weiterlaufen. Die Zeiten rechnen von den Startzeiten aus und bleiben korrekt.
  private restoreSnapshotIfOffline(err: unknown): void {
    const offline = err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500);
    if (!offline || this.einsatz()) {
      return;
    }
    const snapshot = this.readSnapshot();
    if (!snapshot) {
      return;
    }
    this.einsatz.set(snapshot.einsatz);
    this.serverTrupps.set(snapshot.trupps.map(normalizeTrupp));
    this.snapshotFrom.set(snapshot.savedAt);
    this.updateWakeLock();
  }

  private readSnapshot(): { einsatz: Einsatz; trupps: Trupp[]; savedAt: string } | null {
    if (!this.snapshotKey) {
      return null;
    }
    try {
      const raw = localStorage.getItem(this.snapshotKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeSnapshot(snapshot: { einsatz: Einsatz; trupps: Trupp[]; savedAt: string } | null): void {
    if (!this.snapshotKey) {
      return;
    }
    try {
      if (snapshot) {
        localStorage.setItem(this.snapshotKey, JSON.stringify(snapshot));
      } else {
        localStorage.removeItem(this.snapshotKey);
      }
    } catch {
      // Speicher nicht verfuegbar: ohne Schnappschuss weiter
    }
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
    this.alarm.set(null);
    // Ueber die Warteschlange: die Quittierung gilt sofort (auch offline) und wird uebertragen, sobald moeglich.
    this.outbox
      .submit({
        id: this.outbox.newId(),
        kind: 'event',
        truppId: trupp.id,
        truppName: trupp.bezeichnung,
        typ: type === 'warn' ? 'warn_ack' : 'max_ack',
        zeit: this.outbox.nowIso()
      })
      .then((result) => {
        if (result.status === 'rejected') {
          this.notify(result.error, 'warn');
        }
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

  private updateConnectionState(): void {
    const lost = !navigator.onLine || this.realtimeStatus !== 'connected';
    if (!lost) {
      this.lostSince = null;
      this.connectionLost.set(false);
      return;
    }
    this.lostSince ??= Date.now();
    this.connectionLost.set(Date.now() - this.lostSince >= 5000);
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
    this.outbox.submit({
      id: this.outbox.newId(),
      kind: 'event',
      truppId: trupp.id,
      truppName: trupp.bezeichnung,
      typ: type,
      zeit: this.outbox.nowIso()
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
