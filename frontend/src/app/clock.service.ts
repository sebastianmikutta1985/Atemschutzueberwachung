import { Injectable, signal } from '@angular/core';

// Gleicht die Geraeteuhr mit der Serverzeit ab. Restzeiten der Trupps haengen sonst von der Uhr des
// jeweiligen Tablets ab; eine falsch gehende Uhr wuerde falsche Warn- und Maximalzeiten anzeigen.
@Injectable({ providedIn: 'root' })
export class ClockService {
  // Der Date-Header hat nur Sekundenaufloesung; kleinere Abweichungen werden daher ignoriert.
  private static readonly minRelevantOffsetMs = 2000;

  readonly offsetMs = signal(0);

  now(): number {
    return Date.now() + this.offsetMs();
  }

  sync(serverDateHeader: string | null, requestStart: number, responseEnd: number): void {
    if (!serverDateHeader) {
      return;
    }
    const serverTime = Date.parse(serverDateHeader);
    if (Number.isNaN(serverTime)) {
      return;
    }
    // Header-Zeit liegt irgendwo in der Sekunde zwischen Anfrage und Antwort; Mitte der Sekunde annehmen.
    const localMidpoint = (requestStart + responseEnd) / 2;
    const offset = serverTime + 500 - localMidpoint;
    this.offsetMs.set(Math.abs(offset) < ClockService.minRelevantOffsetMs ? 0 : Math.round(offset));
  }
}
