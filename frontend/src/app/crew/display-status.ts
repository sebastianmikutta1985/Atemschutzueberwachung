import { retreatInfo, statusFor } from '../crew-status';
import { Trupp } from '../models';

// Angezeigter Status einer Trupp-Karte. Fasst nur vorhandene Berechnungen zusammen (Zeitstatus, Rueckzugsdruck,
// Mayday) und aendert keine Fachlogik. 'funkausfall' ist vorbereitet, wird aber noch nicht ermittelt.
export type DisplayStatus = 'mayday' | 'ueberfaellig' | 'funkausfall' | 'rueckzug' | 'ok' | 'beendet';

export function displayStatus(trupp: Trupp, nowEpoch: number): DisplayStatus {
  // Ein offener Mayday ist immer das Wichtigste, auch wenn der Trupp schon beendet wurde.
  if (trupp.maydayAktiv) {
    return 'mayday';
  }
  const time = statusFor(trupp, nowEpoch);
  if (time === 'beendet') {
    return 'beendet';
  }
  if (time === 'rot') {
    return 'ueberfaellig';
  }
  const retreat = retreatInfo(trupp, nowEpoch);
  if (time === 'gelb' || retreat?.reached || retreat?.estimatedReached) {
    return 'rueckzug';
  }
  return 'ok';
}
