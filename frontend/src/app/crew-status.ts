import { DruckInfo, Trupp } from './models';
import type { OutboxItem } from './outbox.service';

// Reine Berechnungen rund um einen Trupp – ohne Angular-Abhaengigkeiten, damit sie einzeln testbar sind.

export type CrewStatus = 'gruen' | 'gelb' | 'rot' | 'beendet';
export type PressureCheckStage = 1 | 2;

export function parseEpoch(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeTrupp(trupp: Trupp): Trupp {
  const messungen1 = trupp.druckMessungenPerson1 ?? [];
  const messungen2 = trupp.druckMessungenPerson2 ?? [];
  const endzeit = trupp.endzeit ? trupp.endzeit : null;
  return {
    ...trupp,
    endzeit,
    druckMessungenPerson1: messungen1,
    druckMessungenPerson2: messungen2,
    druckCountPerson1: trupp.druckCountPerson1 ?? messungen1.length,
    druckCountPerson2: trupp.druckCountPerson2 ?? messungen2.length,
    startEpoch: parseEpoch(trupp.startzeit),
    endEpoch: endzeit ? parseEpoch(endzeit) : null
  };
}

// Aktive Trupps zuerst, innerhalb davon nach Startzeit.
export function sortTrupps(trupps: Trupp[]): Trupp[] {
  return [...trupps].sort((a, b) => {
    const aEnded = a.endzeit ? 1 : 0;
    const bEnded = b.endzeit ? 1 : 0;
    if (aEnded !== bEnded) {
      return aEnded - bEnded;
    }
    return (a.startEpoch ?? 0) - (b.startEpoch ?? 0);
  });
}

export function elapsedSeconds(trupp: Trupp, nowEpoch: number): number {
  const start = trupp.startEpoch ?? parseEpoch(trupp.startzeit) ?? 0;
  const end = trupp.endEpoch ?? (trupp.endzeit ? parseEpoch(trupp.endzeit) ?? nowEpoch : nowEpoch);
  return Math.floor((end - start) / 1000);
}

export function statusFor(trupp: Trupp, nowEpoch: number): CrewStatus {
  if (trupp.endzeit) {
    return 'beendet';
  }
  const elapsedMin = Math.floor(elapsedSeconds(trupp, nowEpoch) / 60);
  if (elapsedMin >= trupp.maxzeitMin) {
    return 'rot';
  }
  if (elapsedMin >= trupp.warnzeitMin) {
    return 'gelb';
  }
  return 'gruen';
}

export function remainingSeconds(trupp: Trupp, nowEpoch: number): number {
  return Math.max(Math.ceil(trupp.maxzeitMin * 60 - elapsedSeconds(trupp, nowEpoch)), 0);
}

export function formatMinSec(totalSeconds: number): string {
  const safe = Math.max(totalSeconds, 0);
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`;
}

// Druckkontrolle nach etwa 1/3 und 2/3 der Einsatzzeit (FwDV 7). Faellig, solange nicht fuer beide
// Personen mindestens so viele Messungen vorliegen, wie Kontrollpunkte erreicht sind.
export function pressureCheckDue(trupp: Trupp, nowEpoch: number): PressureCheckStage | null {
  if (trupp.endzeit) {
    return null;
  }
  const elapsed = elapsedSeconds(trupp, nowEpoch);
  const maxSec = trupp.maxzeitMin * 60;
  const stage = elapsed >= (maxSec * 2) / 3 ? 2 : elapsed >= maxSec / 3 ? 1 : 0;
  if (stage === 0) {
    return null;
  }
  const done = Math.min(trupp.druckCountPerson1, trupp.druckCountPerson2);
  return done < stage ? stage : null;
}

export function pressureCheckFraction(stage: PressureCheckStage): string {
  return stage === 1 ? '⅓' : '⅔';
}

// Der Trupp muss sich nach dem Geraet mit dem niedrigsten Druck richten.
export function lowestPressure(trupp: Trupp): number {
  const p1 = trupp.druckMessungenPerson1[0]?.druckBar ?? trupp.startdruckPerson1Bar;
  const p2 = trupp.druckMessungenPerson2[0]?.druckBar ?? trupp.startdruckPerson2Bar;
  return Math.min(p1, p2);
}

// Blendet noch nicht uebertragene Eingaben der Offline-Warteschlange in die Serverdaten ein: sie erscheinen sofort
// auf dem Geraet und zaehlen fuer Druckabfrage, niedrigsten Druck und Alarme mit.
export function applyPending(trupps: Trupp[], pending: OutboxItem[]): Trupp[] {
  if (!pending.length) {
    return trupps;
  }
  return trupps.map((original) => {
    const own = pending.filter((p) => p.truppId === original.id);
    if (!own.length) {
      return original;
    }
    const trupp: Trupp = {
      ...original,
      druckMessungenPerson1: [...original.druckMessungenPerson1],
      druckMessungenPerson2: [...original.druckMessungenPerson2]
    };
    for (const item of own) {
      if (item.kind === 'druck' && item.druckBar !== undefined) {
        const reading: DruckInfo = { id: item.id, personId: item.personId, druckBar: item.druckBar, zeit: item.zeit, pending: true };
        if (item.personId === trupp.person1Id) {
          trupp.druckMessungenPerson1.push(reading);
          trupp.druckCountPerson1 += 1;
        } else if (item.personId === trupp.person2Id) {
          trupp.druckMessungenPerson2.push(reading);
          trupp.druckCountPerson2 += 1;
        }
      } else if (item.kind === 'end' && !trupp.endzeit) {
        trupp.endzeit = item.zeit;
        trupp.endEpoch = parseEpoch(item.zeit);
        trupp.endPending = true;
      } else if (item.kind === 'event' && item.typ === 'warn_ack') {
        trupp.warnAcked = true;
      } else if (item.kind === 'event' && item.typ === 'max_ack') {
        trupp.maxAcked = true;
      }
    }
    // Neueste Messung zuerst, wie vom Server geliefert.
    const newestFirst = (a: DruckInfo, b: DruckInfo) => (parseEpoch(b.zeit) ?? 0) - (parseEpoch(a.zeit) ?? 0);
    trupp.druckMessungenPerson1.sort(newestFirst);
    trupp.druckMessungenPerson2.sort(newestFirst);
    return trupp;
  });
}
