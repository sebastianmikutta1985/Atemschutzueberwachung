import {
  formatMinSec,
  lowestPressure,
  normalizeTrupp,
  pressureCheckDue,
  remainingSeconds,
  sortTrupps,
  statusFor
} from './crew-status';
import { Trupp } from './models';

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
    startdruckPerson2Bar: 280,
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

describe('crew-status', () => {
  it('switches from green to yellow at the warning time and to red at the max time', () => {
    const t = crew();
    expect(statusFor(t, start + 24 * min)).toBe('gruen');
    expect(statusFor(t, start + 25 * min)).toBe('gelb');
    expect(statusFor(t, start + 30 * min)).toBe('rot');
    expect(statusFor(crew({ endzeit: '2026-09-26T10:10:00Z' }), start + 40 * min)).toBe('beendet');
  });

  it('computes and formats the remaining time and never goes below zero', () => {
    const t = crew();
    expect(formatMinSec(remainingSeconds(t, start + 10 * min + 15_000))).toBe('19:45');
    expect(remainingSeconds(t, start + 45 * min)).toBe(0);
  });

  it('requests pressure checks at 1/3 and 2/3 until both persons have enough readings', () => {
    expect(pressureCheckDue(crew(), start + 9 * min)).toBeNull();
    expect(pressureCheckDue(crew(), start + 10 * min)).toBe(1);
    expect(pressureCheckDue(crew({ druckCountPerson1: 1 }), start + 10 * min)).toBe(1);
    expect(pressureCheckDue(crew({ druckCountPerson1: 1, druckCountPerson2: 1 }), start + 10 * min)).toBeNull();
    expect(pressureCheckDue(crew({ druckCountPerson1: 1, druckCountPerson2: 1 }), start + 20 * min)).toBe(2);
    expect(pressureCheckDue(crew({ endzeit: '2026-09-26T10:05:00Z' }), start + 20 * min)).toBeNull();
  });

  it('uses the latest reading per person for the lowest pressure', () => {
    expect(lowestPressure(crew())).toBe(280);
    const t = crew({
      druckMessungenPerson1: [{ id: 'm2', personId: 'p1', druckBar: 150, zeit: '2026-09-26T10:20:00Z' }],
      druckMessungenPerson2: [{ id: 'm1', personId: 'p2', druckBar: 200, zeit: '2026-09-26T10:10:00Z' }]
    });
    expect(lowestPressure(t)).toBe(150);
  });

  it('sorts active crews first, then by start time', () => {
    const ended = crew({ id: 'ended', startzeit: '2026-09-26T09:00:00Z', endzeit: '2026-09-26T09:30:00Z' });
    const late = crew({ id: 'late', startzeit: '2026-09-26T10:30:00Z' });
    const early = crew({ id: 'early', startzeit: '2026-09-26T10:00:00Z' });
    expect(sortTrupps([ended, late, early]).map((t) => t.id)).toEqual(['early', 'late', 'ended']);
  });
});
