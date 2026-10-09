import {
  applyPending,
  elapsedSeconds,
  formatMinSec,
  lowestPressure,
  nextZustand,
  normalizeTrupp,
  pressureCheckDue,
  remainingSeconds,
  retreatInfo,
  sortTrupps,
  statusFor,
  zustandOf
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

  it('shows pending entries immediately and counts them for pressure checks and alarms', () => {
    const t = crew({
      druckCountPerson1: 1,
      druckMessungenPerson1: [{ druckBar: 260, zeit: '2026-09-26T10:08:00Z' }]
    });
    const [merged] = applyPending(
      [t],
      [
        { id: 'm1', kind: 'druck', truppId: 't1', truppName: 'AT', personId: 'p1', druckBar: 240, zeit: '2026-09-26T10:12:00Z' },
        { id: 'm2', kind: 'druck', truppId: 't1', truppName: 'AT', personId: 'p2', druckBar: 250, zeit: '2026-09-26T10:12:30Z' },
        { id: 'a1', kind: 'event', truppId: 't1', truppName: 'AT', typ: 'warn_ack', zeit: '2026-09-26T10:13:00Z' },
        { id: 'x', kind: 'druck', truppId: 'other', truppName: 'X', personId: 'p1', druckBar: 100, zeit: '2026-09-26T10:13:00Z' }
      ]
    );
    expect(merged.druckCountPerson1).toBe(2);
    expect(merged.druckMessungenPerson1.map((m) => [m.druckBar, !!m.pending])).toEqual([[240, true], [260, false]]);
    expect(lowestPressure(merged)).toBe(240);
    expect(pressureCheckDue(merged, start + 10 * min)).toBeNull();
    expect(merged.warnAcked).toBe(true);
    // Das Original bleibt unveraendert.
    expect(t.druckCountPerson1).toBe(1);
  });

  it('ends a crew locally with the captured time while the end is pending', () => {
    const [merged] = applyPending([crew()], [{ id: 'e1', kind: 'end', truppId: 't1', truppName: 'AT', zeit: '2026-09-26T10:15:00Z' }]);
    expect(merged.endPending).toBe(true);
    expect(statusFor(merged, start + 40 * min)).toBe('beendet');
    expect(formatMinSec(elapsedSeconds(merged, start + 40 * min))).toBe('15:00');
  });

  it('sorts active crews first, then by start time', () => {
    const ended = crew({ id: 'ended', startzeit: '2026-09-26T09:00:00Z', endzeit: '2026-09-26T09:30:00Z' });
    const late = crew({ id: 'late', startzeit: '2026-09-26T10:30:00Z' });
    const early = crew({ id: 'early', startzeit: '2026-09-26T10:00:00Z' });
    expect(sortTrupps([ended, late, early]).map((t) => t.id)).toEqual(['early', 'late', 'ended']);
  });

  it('walks the crew states forward and treats crews without a state as approaching', () => {
    expect(zustandOf(crew())).toBe('anmarsch');
    expect(nextZustand(crew())).toBe('arbeit');
    expect(nextZustand(crew({ zustand: 'arbeit' }))).toBe('rueckweg');
    expect(nextZustand(crew({ zustand: 'rueckweg' }))).toBe('beendet');
    const ended = crew({ zustand: 'arbeit', endzeit: '2026-09-26T10:20:00Z' });
    expect(zustandOf(ended)).toBe('beendet');
    expect(nextZustand(ended)).toBeNull();
  });

  it('applies a pending "target reached" with its pressures and never moves a crew backwards', () => {
    const [merged] = applyPending(
      [crew()],
      [
        {
          id: 'z1',
          kind: 'zustand',
          truppId: 't1',
          truppName: 'AT',
          zustand: 'arbeit',
          zeit: '2026-09-26T10:06:00Z',
          zielDruck: [
            { id: 'd1', personId: 'p1', personName: 'A', druckBar: 250 },
            { id: 'd2', personId: 'p2', personName: 'B', druckBar: 240 }
          ]
        }
      ]
    );
    expect(zustandOf(merged)).toBe('arbeit');
    expect(merged.zustandPending).toBe(true);
    expect(merged.zustandSeit).toBe('2026-09-26T10:06:00Z');
    expect(merged.druckCountPerson1).toBe(1);
    expect(merged.druckMessungenPerson2[0]).toEqual(expect.objectContaining({ druckBar: 240, anlass: 'ziel', pending: true }));
    expect(lowestPressure(merged)).toBe(240);

    const [unchanged] = applyPending(
      [crew({ zustand: 'rueckweg' })],
      [{ id: 'z2', kind: 'zustand', truppId: 't1', truppName: 'AT', zustand: 'arbeit', zeit: '2026-09-26T10:06:00Z' }]
    );
    expect(zustandOf(unchanged)).toBe('rueckweg');
    expect(unchanged.zustandPending).toBeUndefined();
  });

  it('shows a pending mayday immediately, merges added details and closes it again', () => {
    const base = { truppId: 't1', truppName: 'AT', kind: 'event' as const };
    const [open] = applyPending(
      [crew()],
      [
        { ...base, id: 'x1', typ: 'mayday', position: 'Keller', zeit: '2026-09-26T10:10:00Z' },
        { ...base, id: 'x2', typ: 'mayday_info', restdruck: 90, nachricht: 'Atemnot', zeit: '2026-09-26T10:11:00Z' }
      ]
    );
    expect(open.maydayAktiv).toBe(true);
    expect(open.maydayPending).toBe(true);
    expect(open.maydaySeit).toBe('2026-09-26T10:10:00Z');
    expect([open.maydayPosition, open.maydayRestdruck, open.maydayFunkspruch]).toEqual(['Keller', 90, 'Atemnot']);

    const [closed] = applyPending(
      [crew({ maydayAktiv: true, maydaySeit: '2026-09-26T10:10:00Z' })],
      [{ ...base, id: 'x3', typ: 'mayday_ende', nachricht: 'gerettet', zeit: '2026-09-26T10:20:00Z' }]
    );
    expect(closed.maydayAktiv).toBe(false);
  });

  describe('retreat pressure', () => {
    const at = (m: number) => new Date(start + m * min).toISOString();
    const working = (overrides: Partial<Trupp> = {}) =>
      crew({
        zustand: 'arbeit',
        zustandSeit: at(8),
        druckMessungenPerson1: [{ druckBar: 260, zeit: at(8), anlass: 'ziel' }],
        druckMessungenPerson2: [{ druckBar: 250, zeit: at(8), anlass: 'ziel' }],
        ...overrides
      });

    it('needs twice the outbound consumption plus the reserve and predicts when it is reached', () => {
      const info = retreatInfo(working(), start + 9 * min)!;
      // P1: 300 -> 260 = 40 bar, 2 x 40 + 10 = 90; P2: 280 -> 250 = 30 bar, 2 x 30 + 10 = 70
      expect(info.members.map((m) => [m.verbrauchBar, m.rueckzugBar])).toEqual([[40, 90], [30, 70]]);
      expect(info.reached).toBeNull();
      // Hinweg: P1 5 bar/min, (260 - 90) / 5 = 34 min nach dem Ziel; P2 spaeter
      expect(info.etaEpoch).toBe(start + 42 * min);
      expect(info.estimatedReached).toBe(false);
      expect(retreatInfo(working(), start + 42 * min)!.estimatedReached).toBe(true);
      expect(retreatInfo(working({ rueckzugReserveBar: 20 }), start)!.members[0].rueckzugBar).toBe(100);
    });

    it('uses the consumption since reaching the target once a later reading exists', () => {
      const info = retreatInfo(
        working({
          druckMessungenPerson1: [
            { druckBar: 200, zeit: at(18) },
            { druckBar: 260, zeit: at(8), anlass: 'ziel' }
          ]
        }),
        start + 18 * min
      )!;
      // 6 bar/min seit dem Ziel: (200 - 90) / 6 = 18 min 20 s nach der letzten Messung
      expect(info.etaEpoch).toBe(start + 36 * min + 20_000);
    });

    it('reports the crew member who reached the retreat pressure', () => {
      const info = retreatInfo(
        working({
          druckMessungenPerson2: [
            { druckBar: 70, zeit: at(30) },
            { druckBar: 250, zeit: at(8), anlass: 'ziel' }
          ]
        }),
        start + 30 * min
      )!;
      expect(info.reached?.personId).toBe('p2');
      expect(info.etaEpoch).toBeNull();
      // Bereits am Ziel zu viel verbraucht: sofort zurueck
      expect(retreatInfo(working({ druckMessungenPerson1: [{ druckBar: 200, zeit: at(8), anlass: 'ziel' }] }), start)!.reached?.personId).toBe('p1');
    });

    it('falls back to the first reading at the target and flags crews without one', () => {
      const skipped = working({
        druckMessungenPerson1: [
          { druckBar: 240, zeit: at(15) },
          { druckBar: 250, zeit: at(12) },
          { druckBar: 280, zeit: at(5) }
        ],
        druckMessungenPerson2: []
      });
      const info = retreatInfo(skipped, start + 15 * min)!;
      expect(info.missing).toBe(true);
      expect(info.members).toHaveLength(1);
      expect(info.members[0].zielBar).toBe(250);
    });

    it('only applies while the crew is working at the target', () => {
      expect(retreatInfo(crew(), start)).toBeNull();
      expect(retreatInfo(working({ zustand: 'rueckweg' }), start)).toBeNull();
      expect(retreatInfo(working({ endzeit: at(40) }), start)).toBeNull();
    });

    it('marks the retreat alarm as acknowledged while the acknowledgement is pending', () => {
      const [t] = applyPending([working()], [{ id: 'a1', kind: 'event', truppId: 't1', truppName: 'AT', typ: 'rueckzug_ack', zeit: at(30) }]);
      expect(t.rueckzugAcked).toBe(true);
    });
  });
});
