import { DruckInfo, Trupp, TruppZustand } from './models';
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

const ZUSTAND_RANG: Record<TruppZustand, number> = { anmarsch: 0, arbeit: 1, rueckweg: 2, beendet: 3 };

// Trupps aus aelteren Versionen haben keinen Zustand: sie gelten als im Anmarsch.
export function zustandOf(trupp: Trupp): TruppZustand {
  return trupp.endzeit ? 'beendet' : (trupp.zustand ?? 'anmarsch');
}

// Naechster regulaerer Schritt; im Rueckweg ist das die Rueckkehr (= Trupp beenden).
export function nextZustand(trupp: Trupp): Exclude<TruppZustand, 'anmarsch'> | null {
  switch (zustandOf(trupp)) {
    case 'anmarsch':
      return 'arbeit';
    case 'arbeit':
      return 'rueckweg';
    case 'rueckweg':
      return 'beendet';
    default:
      return null;
  }
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

// Rueckzugsdruck: der Rueckweg braucht so viel Luft wie der Hinweg; zur Sicherheit wird der doppelte Verbrauch
// angesetzt, dazu eine Reserve. Faellt ein Geraet auf diesen Wert, muss der Trupp den Rueckzug antreten.
export const DEFAULT_RESERVE_BAR = 10;

export interface RetreatMember {
  personId: string;
  // Druck am Ziel (Grundlage der Berechnung) und Verbrauch auf dem Hinweg
  zielBar: number;
  verbrauchBar: number;
  rueckzugBar: number;
  current: number;
  reached: boolean;
  // Voraussichtlicher Zeitpunkt, an dem der Rueckzugsdruck erreicht wird; null = bereits erreicht oder keine Prognose.
  etaEpoch: number | null;
}

export interface RetreatInfo {
  reserveBar: number;
  members: RetreatMember[];
  // Fuer mindestens eine Person fehlt der Druck am Ziel: keine vollstaendige Berechnung.
  missing: boolean;
  // Gemeldeter Druck hat den Rueckzugsdruck erreicht (Person mit dem knappsten Wert).
  reached: RetreatMember | null;
  etaEpoch: number | null;
  // Laut Prognose erreicht, aber noch nicht durch eine Messung bestaetigt: Druck abfragen.
  estimatedReached: boolean;
}

const MIN_RATE_SPAN_MS = 60_000;

// Nur im Zustand "arbeit" sinnvoll: vorher fehlt der Druck am Ziel, danach ist der Trupp schon auf dem Rueckweg.
export function retreatInfo(trupp: Trupp, nowEpoch: number): RetreatInfo | null {
  if (zustandOf(trupp) !== 'arbeit') {
    return null;
  }
  const reserveBar = trupp.rueckzugReserveBar ?? DEFAULT_RESERVE_BAR;
  const arbeitSeit = parseEpoch(trupp.zustandSeit) ?? 0;
  const startEpoch = trupp.startEpoch ?? parseEpoch(trupp.startzeit) ?? 0;
  const member = (personId: string, start: number, newestFirst: DruckInfo[]): RetreatMember | null => {
    // Druck mit "Ziel erreicht"; wurde er nicht gemeldet, zaehlt die erste Messung am Ziel (eher zu frueh als zu spaet).
    const basis =
      newestFirst.find((r) => r.anlass === 'ziel') ??
      [...newestFirst].reverse().find((r) => (parseEpoch(r.zeit) ?? 0) >= arbeitSeit);
    if (!basis) {
      return null;
    }
    const latest = newestFirst[0];
    const verbrauchBar = Math.max(start - basis.druckBar, 0);
    const rueckzugBar = 2 * verbrauchBar + reserveBar;
    const reached = latest.druckBar <= rueckzugBar;
    let etaEpoch: number | null = null;
    if (!reached) {
      const tBasis = parseEpoch(basis.zeit) ?? 0;
      const tLatest = parseEpoch(latest.zeit) ?? 0;
      // Verbrauch pro ms: bevorzugt seit Erreichen des Ziels (Arbeit verbraucht meist mehr), sonst der des Hinwegs.
      const rates = [
        tLatest - tBasis >= MIN_RATE_SPAN_MS ? (basis.druckBar - latest.druckBar) / (tLatest - tBasis) : 0,
        tBasis - startEpoch >= MIN_RATE_SPAN_MS ? verbrauchBar / (tBasis - startEpoch) : 0
      ];
      const rate = rates.find((r) => r > 0);
      if (rate) {
        etaEpoch = Math.round(tLatest + (latest.druckBar - rueckzugBar) / rate);
      }
    }
    return { personId, zielBar: basis.druckBar, verbrauchBar, rueckzugBar, current: latest.druckBar, reached, etaEpoch };
  };
  const all = [
    member(trupp.person1Id, trupp.startdruckPerson1Bar, trupp.druckMessungenPerson1),
    member(trupp.person2Id, trupp.startdruckPerson2Bar, trupp.druckMessungenPerson2)
  ];
  const members = all.filter((m): m is RetreatMember => m !== null);
  const reached =
    members.filter((m) => m.reached).sort((a, b) => a.current - a.rueckzugBar - (b.current - b.rueckzugBar))[0] ?? null;
  const etas = members.map((m) => m.etaEpoch).filter((e): e is number => e !== null);
  const etaEpoch = reached || !etas.length ? null : Math.min(...etas);
  return {
    reserveBar,
    members,
    missing: members.length < all.length,
    reached,
    etaEpoch,
    estimatedReached: etaEpoch !== null && nowEpoch >= etaEpoch
  };
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
      } else if (item.kind === 'zustand' && item.zustand && ZUSTAND_RANG[item.zustand] > ZUSTAND_RANG[zustandOf(trupp)]) {
        trupp.zustand = item.zustand;
        trupp.zustandSeit = item.zeit;
        trupp.zustandPending = true;
        for (const d of item.zielDruck ?? []) {
          const reading: DruckInfo = { id: d.id, personId: d.personId, druckBar: d.druckBar, zeit: item.zeit, anlass: 'ziel', pending: true };
          if (d.personId === trupp.person1Id) {
            trupp.druckMessungenPerson1.push(reading);
            trupp.druckCountPerson1 += 1;
          } else if (d.personId === trupp.person2Id) {
            trupp.druckMessungenPerson2.push(reading);
            trupp.druckCountPerson2 += 1;
          }
        }
      } else if (item.kind === 'end' && !trupp.endzeit) {
        trupp.endzeit = item.zeit;
        trupp.endEpoch = parseEpoch(item.zeit);
        trupp.endPending = true;
      } else if (item.kind === 'event' && item.typ === 'mayday') {
        trupp.maydayAktiv = true;
        trupp.maydaySeit = item.zeit;
        trupp.maydayPosition = item.position ?? null;
        trupp.maydayRestdruck = item.restdruck ?? null;
        trupp.maydayFunkspruch = item.nachricht ?? null;
        trupp.maydayPending = !item.sent;
      } else if (item.kind === 'event' && item.typ === 'mayday_info') {
        trupp.maydayPosition = item.position ?? trupp.maydayPosition;
        trupp.maydayRestdruck = item.restdruck ?? trupp.maydayRestdruck;
        trupp.maydayFunkspruch = item.nachricht ?? trupp.maydayFunkspruch;
      } else if (item.kind === 'event' && item.typ === 'mayday_ende') {
        trupp.maydayAktiv = false;
      } else if (item.kind === 'event' && item.typ === 'warn_ack') {
        trupp.warnAcked = true;
      } else if (item.kind === 'event' && item.typ === 'max_ack') {
        trupp.maxAcked = true;
      } else if (item.kind === 'event' && item.typ === 'rueckzug_ack') {
        trupp.rueckzugAcked = true;
      }
    }
    // Neueste Messung zuerst, wie vom Server geliefert.
    const newestFirst = (a: DruckInfo, b: DruckInfo) => (parseEpoch(b.zeit) ?? 0) - (parseEpoch(a.zeit) ?? 0);
    trupp.druckMessungenPerson1.sort(newestFirst);
    trupp.druckMessungenPerson2.sort(newestFirst);
    return trupp;
  });
}
