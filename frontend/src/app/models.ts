export interface Einsatz {
  id: string;
  name: string;
  ort: string;
  alarmzeit: string;
  status: string;
  endzeit?: string | null;
}

export interface DruckInfo {
  id: string;
  personId: string;
  druckBar: number;
  zeit: string;
}

export interface Trupp {
  id: string;
  einsatzId: string;
  bezeichnung: string;
  person1Id: string;
  person2Id: string;
  person1Name: string;
  person2Name: string;
  startdruckPerson1Bar: number;
  startdruckPerson2Bar: number;
  startzeit: string;
  warnzeitMin: number;
  maxzeitMin: number;
  endzeit?: string | null;
  startEpoch?: number | null;
  endEpoch?: number | null;
  druckCountPerson1: number;
  druckCountPerson2: number;
  druckMessungenPerson1: DruckInfo[];
  druckMessungenPerson2: DruckInfo[];
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
