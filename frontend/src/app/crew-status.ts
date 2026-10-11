import { DruckInfo, Trupp, TruppMitglied, TruppZustand } from './models';
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

// Gespeicherte Schnappschuesse aus Versionen vor der variablen Truppgroesse kennen nur zwei feste Personen.
interface LegacyTrupp {
  person1Id?: string;
  person2Id?: string;
  person1Name?: string;
  person2Name?: string;
  startdruckPerson1Bar?: number;
  startdruckPerson2Bar?: number;
  druckMessungenPerson1?: DruckInfo[];
  druckMessungenPerson2?: DruckInfo[];
}

function legacyMitglieder(t: LegacyTrupp): TruppMitglied[] {
  if (!t.person1Id || !t.person2Id) {
    return [];
  }
  const m1 = t.druckMessungenPerson1 ?? [];
  const m2 = t.druckMessungenPerson2 ?? [];
  return [
    {
      personId: t.person1Id,
      name: t.person1Name ?? '',
      rolle: 'fuehrer',
      startdruckBar: t.startdruckPerson1Bar ?? 300,
      druckCount: m1.length,
      druckMessungen: m1
    },
    {
      personId: t.person2Id,
      name: t.person2Name ?? '',
      rolle: 'mitglied',
      startdruckBar: t.startdruckPerson2Bar ?? 300,
      druckCount: m2.length,
      druckMessungen: m2
    }
  ];
}

export function normalizeTrupp(trupp: Trupp): Trupp {
  const endzeit = trupp.endzeit ? trupp.endzeit : null;
  const mitglieder = (trupp.mitglieder ?? legacyMitglieder(trupp as Trupp & LegacyTrupp)).map((m) => {
    const druckMessungen = m.druckMessungen ?? [];
    return { ...m, druckMessungen, druckCount: m.druckCount ?? druckMessungen.length };
  });
  return {
    ...trupp,
    endzeit,
    mitglieder,
    startEpoch: parseEpoch(trupp.startzeit),
    endEpoch: endzeit ? parseEpoch(endzeit) : null
  };
}

export function mitgliedOf(trupp: Trupp, personId: string): TruppMitglied | undefined {
  return trupp.mitglieder.find((m) => m.personId === personId);
}

export function memberNames(trupp: Trupp, separator = ' · '): string {
  return trupp.mitglieder.map((m) => m.name).join(separator);
}

// Rolle als Uebersetzungsschluessel plus Nummer: Truppfuehrer, dann Truppmann bzw. Truppmann 1, 2, 3.
// Gilt fuer den Trupp ebenso wie fuer das Anlegeformular (Position in der Liste, Anzahl der Personen).
export interface MemberRole {
  key: 'leader' | 'member';
  no: number | null;
}

export function memberRole(index: number, count: number): MemberRole {
  if (index === 0) {
    return { key: 'leader', no: null };
  }
  return { key: 'member', no: count > 2 ? index : null };
}

// Ausgeschrieben ("Truppmann 2") oder kurz ("TM2"); translate liefert die Texte aus crewCard.
export function formatRole(index: number, count: number, translate: (key: string) => string, short = false): string {
  const role = memberRole(index, count);
  const label = translate(`crewCard.${role.key}${short ? 'Short' : ''}`);
  if (role.no === null) {
    return label;
  }
  return short ? `${label}${role.no}` : `${label} ${role.no}`;
}

// Letzter gemeldeter Druck, sonst der Startdruck.
export function currentPressure(mitglied: TruppMitglied): number {
  return mitglied.druckMessungen[0]?.druckBar ?? mitglied.startdruckBar;
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

// Druckkontrolle nach etwa 1/3 und 2/3 der Einsatzzeit (FwDV 7). Faellig, solange nicht fuer alle
// Mitglieder mindestens so viele Messungen vorliegen, wie Kontrollpunkte erreicht sind.
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
  const done = Math.min(...trupp.mitglieder.map((m) => m.druckCount));
  return done < stage ? stage : null;
}

export function pressureCheckFraction(stage: PressureCheckStage): string {
  return stage === 1 ? '⅓' : '⅔';
}

// Der Trupp muss sich nach dem Geraet mit dem niedrigsten Druck richten.
export function lowestPressure(trupp: Trupp): number {
  return Math.min(...trupp.mitglieder.map(currentPressure));
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
  const all = trupp.mitglieder.map((m) => member(m.personId, m.startdruckBar, m.druckMessungen));
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
      mitglieder: original.mitglieder.map((m) => ({ ...m, druckMessungen: [...m.druckMessungen] }))
    };
    const addReading = (reading: DruckInfo) => {
      const mitglied = reading.personId ? mitgliedOf(trupp, reading.personId) : undefined;
      if (mitglied) {
        mitglied.druckMessungen.push(reading);
        mitglied.druckCount += 1;
      }
    };
    for (const item of own) {
      if (item.kind === 'druck' && item.druckBar !== undefined) {
        addReading({ id: item.id, personId: item.personId, druckBar: item.druckBar, zeit: item.zeit, pending: true });
      } else if (item.kind === 'zustand' && item.zustand && ZUSTAND_RANG[item.zustand] > ZUSTAND_RANG[zustandOf(trupp)]) {
        trupp.zustand = item.zustand;
        trupp.zustandSeit = item.zeit;
        trupp.zustandPending = true;
        for (const d of item.zielDruck ?? []) {
          addReading({ id: d.id, personId: d.personId, druckBar: d.druckBar, zeit: item.zeit, anlass: 'ziel', pending: true });
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
    for (const m of trupp.mitglieder) {
      m.druckMessungen.sort(newestFirst);
    }
    return trupp;
  });
}
