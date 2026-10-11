export interface Einsatz {
  id: string;
  name: string;
  ort: string;
  alarmzeit: string;
  status: string;
  endzeit?: string | null;
}

// Ablauf eines Trupps: es geht nur vorwaerts ("beendet" ergibt sich aus der Endzeit).
export type TruppZustand = 'anmarsch' | 'arbeit' | 'rueckweg' | 'beendet';

export interface DruckInfo {
  id?: string;
  personId?: string;
  druckBar: number;
  zeit: string;
  // 'ziel' = mit "Ziel erreicht" gemeldet; sonst Druckkontrolle.
  anlass?: string | null;
  // Offline erfasst, noch nicht beim Server angekommen.
  pending?: boolean;
}

export type TruppRolle = 'fuehrer' | 'mitglied';

export interface TruppMitglied {
  personId: string;
  name: string;
  rolle: TruppRolle;
  startdruckBar: number;
  druckCount: number;
  // Neueste Messung zuerst.
  druckMessungen: DruckInfo[];
}

export interface Trupp {
  id: string;
  einsatzId: string;
  bezeichnung: string;
  // Truppfuehrer zuerst, danach die Mitglieder in der Reihenfolge der Anlage.
  mitglieder: TruppMitglied[];
  startzeit: string;
  warnzeitMin: number;
  maxzeitMin: number;
  endzeit?: string | null;
  startEpoch?: number | null;
  endEpoch?: number | null;
  warnAcked?: boolean;
  maxAcked?: boolean;
  // Reserve der Rueckzugsberechnung (beim Anlegen aus den Voreinstellungen uebernommen).
  rueckzugReserveBar?: number;
  // Alarm "Rueckzugsdruck erreicht" quittiert.
  rueckzugAcked?: boolean;
  zustand?: TruppZustand;
  zustandSeit?: string | null;
  // Zustandswechsel offline erfasst, noch nicht beim Server angekommen.
  zustandPending?: boolean;
  // Offener Mayday (Notfallmeldung) mit den zuletzt gemeldeten Angaben.
  maydayAktiv?: boolean;
  maydaySeit?: string | null;
  maydayPosition?: string | null;
  maydayRestdruck?: number | null;
  maydayFunkspruch?: string | null;
  // Mayday auf diesem Geraet ausgeloest, noch nicht beim Server: andere Geraete wissen noch nichts.
  maydayPending?: boolean;
  // Beenden offline erfasst, noch nicht beim Server angekommen.
  endPending?: boolean;
}

export interface ProtokollEintrag {
  zeit: string;
  typ: string;
  zustand?: TruppZustand | null;
  person?: string | null;
  druckBar?: number | null;
  anlass?: string | null;
  nachricht?: string | null;
  nachgetragen: boolean;
  druckNichtGemeldet?: boolean;
  position?: string | null;
  zeitKorrigiert?: boolean;
}

export interface TruppProtokoll {
  truppId: string;
  bezeichnung: string;
  // Namen, Truppfuehrer zuerst.
  mitglieder: string[];
  eintraege: ProtokollEintrag[];
}

export interface AuditEintrag {
  id: string;
  zeit: string;
  rolle: string;
  aktion: string;
  details: string;
}

export interface Geraetetraeger {
  id: string;
  vorname: string;
  nachname: string;
  funkrufname?: string | null;
  aktiv: boolean;
}

export interface TruppName {
  id: string;
  name: string;
  aktiv: boolean;
  orderIndex?: number;
}

export interface OrgSettings {
  defaultStartdruckBar: number;
  defaultWarnzeitMin: number;
  defaultMaxzeitMin: number;
  defaultRueckzugReserveBar: number;
}
