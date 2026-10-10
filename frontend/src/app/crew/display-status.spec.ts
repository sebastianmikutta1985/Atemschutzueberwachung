import { normalizeTrupp } from '../crew-status';
import { Trupp } from '../models';
import { displayStatus } from './display-status';

const start = Date.parse('2026-09-26T10:00:00Z');
const min = 60_000;

function crew(overrides: Partial<Trupp> = {}): Trupp {
  return normalizeTrupp({
    id: 't1',
    einsatzId: 'e1',
    bezeichnung: 'Angriffstrupp',
    person1Id: 'p1',
    person2Id: 'p2',
    person1Name: 'A',
    person2Name: 'B',
    startdruckPerson1Bar: 300,
    startdruckPerson2Bar: 300,
    startzeit: '2026-09-26T10:00:00Z',
    warnzeitMin: 25,
    maxzeitMin: 30,
    endzeit: null,
    druckCountPerson1: 0,
    druckCountPerson2: 0,
    druckMessungenPerson1: [],
    druckMessungenPerson2: [],
    ...overrides
  });
}

describe('displayStatus', () => {
  it('follows the time status: ok, retreat at the warning time, overdue at the max time', () => {
    expect(displayStatus(crew(), start + 10 * min)).toBe('ok');
    expect(displayStatus(crew(), start + 25 * min)).toBe('rueckzug');
    expect(displayStatus(crew(), start + 30 * min)).toBe('ueberfaellig');
  });

  it('shows finished crews as finished', () => {
    expect(displayStatus(crew({ endzeit: '2026-09-26T10:20:00Z' }), start + 40 * min)).toBe('beendet');
  });

  it('shows retreat once a reading reaches the retreat pressure, even before the warning time', () => {
    // Ziel mit 240 bar erreicht: Verbrauch 60, Rueckzug bei 2 x 60 + 10 = 130 bar
    const t = crew({
      zustand: 'arbeit',
      zustandSeit: '2026-09-26T10:05:00Z',
      druckCountPerson1: 2,
      druckCountPerson2: 1,
      druckMessungenPerson1: [
        { druckBar: 125, zeit: '2026-09-26T10:12:00Z' },
        { druckBar: 240, zeit: '2026-09-26T10:05:00Z', anlass: 'ziel' }
      ],
      druckMessungenPerson2: [{ druckBar: 250, zeit: '2026-09-26T10:05:00Z', anlass: 'ziel' }]
    });
    expect(displayStatus(t, start + 12 * min)).toBe('rueckzug');
  });

  it('puts an open mayday above every other status', () => {
    expect(displayStatus(crew({ maydayAktiv: true }), start + 5 * min)).toBe('mayday');
    expect(displayStatus(crew({ maydayAktiv: true }), start + 45 * min)).toBe('mayday');
    expect(displayStatus(crew({ maydayAktiv: true, endzeit: '2026-09-26T10:20:00Z' }), start + 40 * min)).toBe('mayday');
  });
});
