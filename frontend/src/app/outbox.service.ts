import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { environment } from '../environments/environment';
import { ClockService } from './clock.service';

// Offline-Warteschlange fuer Eingaben waehrend der Ueberwachung (Druckmessung, Trupp beenden, Alarm-Events).
// Jede Eingabe wird zuerst dauerhaft gespeichert und dann gesendet; sie traegt eine eigene ID (Server erkennt
// Wiederholungen) und ihre Erfassungszeit (Uhr mit dem Server abgeglichen).

export type OutboxKind = 'druck' | 'end' | 'event';
export type AlarmEventType = 'warn' | 'max' | 'warn_ack' | 'max_ack';

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  truppId: string;
  truppName: string;
  personId?: string;
  personName?: string;
  druckBar?: number;
  typ?: AlarmEventType;
  // Erfassungszeit (UTC, ISO)
  zeit: string;
  // Vom Server abgelehnt: bleibt sichtbar, bis es verworfen wird.
  error?: string;
  // Beim Server angekommen; bleibt eingeblendet, bis die neuen Serverdaten geladen sind (kein kurzes Verschwinden).
  sent?: boolean;
}

export type SubmitResult = { status: 'sent' } | { status: 'queued' } | { status: 'rejected'; error: string };

type SendOutcome = 'sent' | 'retry' | 'auth' | { rejected: string };

@Injectable({ providedIn: 'root' })
export class OutboxService {
  private readonly http = inject(HttpClient);
  private readonly clock = inject(ClockService);
  private readonly baseUrl = environment.apiBaseUrl;

  private readonly items = signal<OutboxItem[]>([]);
  // Einzublenden: wartend oder gesendet, aber noch nicht in den geladenen Serverdaten.
  readonly pending = computed(() => this.items().filter((i) => !i.error));
  // Noch zu uebertragen.
  readonly waiting = computed(() => this.items().filter((i) => !i.error && !i.sent));
  readonly failed = computed(() => this.items().filter((i) => i.error));

  private storageKey: string | null = null;
  private flushing = false;
  private retryTimer?: number;
  private sentListeners: Array<() => void> = [];

  // Laedt die gespeicherten Eintraege dieser Organisation (z. B. nach Neuladen oder erneuter Anmeldung).
  start(orgCode: string): void {
    this.storageKey = `crewtrace_outbox_${orgCode.toLowerCase()}`;
    this.items.set(this.readStorage());
    this.flush();
  }

  // Beim Abmelden: Eintraege bleiben gespeichert und werden nach der naechsten Anmeldung uebertragen.
  stop(): void {
    window.clearTimeout(this.retryTimer);
    this.storageKey = null;
    this.items.set([]);
  }

  onSent(fn: () => void): () => void {
    this.sentListeners.push(fn);
    return () => (this.sentListeners = this.sentListeners.filter((f) => f !== fn));
  }

  nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  newId(): string {
    return crypto.randomUUID();
  }

  // Speichert die Eingabe und sendet sie sofort, wenn nichts anderes wartet. Stehen aeltere Eingaben aus,
  // wird sie hinten angestellt, damit die Reihenfolge erhalten bleibt.
  async submit(item: OutboxItem): Promise<SubmitResult> {
    const queueWasEmpty = this.waiting().length === 0;
    this.update((list) => [...list, item]);
    if (!queueWasEmpty || this.flushing) {
      this.flush();
      return { status: 'queued' };
    }
    this.flushing = true;
    let outcome: SendOutcome;
    try {
      outcome = await this.send(item);
    } finally {
      this.flushing = false;
    }
    if (outcome === 'sent') {
      this.markSent(item.id);
      this.notifySent();
      // Waehrenddessen neu eingereihte Eingaben nachsenden.
      if (this.waiting().length) {
        this.flush();
      }
      return { status: 'sent' };
    }
    if (typeof outcome === 'object') {
      // Direkt abgelehnt, waehrend der Dialog noch offen ist: dort anzeigen statt in der Fehlerliste.
      this.remove(item.id);
      if (this.waiting().length) {
        this.flush();
      }
      return { status: 'rejected', error: outcome.rejected };
    }
    this.scheduleRetry();
    return { status: 'queued' };
  }

  // Sendet alle wartenden Eintraege der Reihe nach. Bei Netz-/Serverproblemen wird spaeter erneut versucht.
  async flush(): Promise<void> {
    if (this.flushing || !this.storageKey) {
      return;
    }
    this.flushing = true;
    let sentAny = false;
    try {
      // Immer den aeltesten wartenden Eintrag nehmen – auch Eingaben, die waehrend der Uebertragung dazukommen.
      while (this.storageKey) {
        const item = this.waiting()[0];
        if (!item) {
          break;
        }
        const outcome = await this.send(item);
        if (outcome === 'sent') {
          this.markSent(item.id);
          sentAny = true;
        } else if (typeof outcome === 'object') {
          this.update((list) => list.map((i) => (i.id === item.id ? { ...i, error: outcome.rejected } : i)));
        } else {
          if (outcome === 'retry') {
            this.scheduleRetry();
          }
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    if (sentAny) {
      this.notifySent();
    }
  }

  discard(id: string): void {
    this.remove(id);
  }

  // Aufzurufen im selben Schritt, in dem die neuen Serverdaten uebernommen werden.
  clearSent(): void {
    if (this.items().some((i) => i.sent)) {
      this.update((list) => list.filter((i) => !i.sent));
    }
  }

  private markSent(id: string): void {
    this.update((list) => list.map((i) => (i.id === id ? { ...i, sent: true } : i)));
  }

  private async send(item: OutboxItem): Promise<SendOutcome> {
    const url = `${this.baseUrl}/trupps/${item.truppId}`;
    const request =
      item.kind === 'druck'
        ? this.http.post(`${url}/druckmessungen`, { personId: item.personId, druckBar: item.druckBar, id: item.id, zeit: item.zeit })
        : item.kind === 'end'
          ? this.http.post(`${url}/beenden`, { endzeit: item.zeit })
          : this.http.post(`${url}/events`, { typ: item.typ, id: item.id, zeit: item.zeit });
    try {
      await firstValueFrom(request.pipe(timeout(10000)));
      return 'sent';
    } catch (err) {
      if (err instanceof TimeoutError) {
        return 'retry';
      }
      if (err instanceof HttpErrorResponse) {
        if (err.status === 0 || err.status >= 500) {
          return 'retry';
        }
        if (err.status === 401) {
          return 'auth';
        }
        return { rejected: err.error?.error ?? `HTTP ${err.status}` };
      }
      return 'retry';
    }
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.flush(), 15000);
  }

  private notifySent(): void {
    this.sentListeners.forEach((fn) => fn());
  }

  private remove(id: string): void {
    this.update((list) => list.filter((i) => i.id !== id));
  }

  private update(fn: (list: OutboxItem[]) => OutboxItem[]): void {
    this.items.update(fn);
    this.writeStorage(this.items());
  }

  private readStorage(): OutboxItem[] {
    if (!this.storageKey) {
      return [];
    }
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    } catch {
      return [];
    }
  }

  private writeStorage(list: OutboxItem[]): void {
    if (!this.storageKey) {
      return;
    }
    try {
      // Gesendete Eintraege nicht mehr speichern: nach einem Neuladen liefert sie der Server.
      const open = list.filter((i) => !i.sent);
      if (open.length) {
        localStorage.setItem(this.storageKey, JSON.stringify(open));
      } else {
        localStorage.removeItem(this.storageKey);
      }
    } catch {
      // Speicher nicht verfuegbar (z. B. privater Modus): Warteschlange laeuft nur im Arbeitsspeicher weiter.
    }
  }
}
