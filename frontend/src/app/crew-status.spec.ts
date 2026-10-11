import {
  applyPending,
  elapsedSeconds,
  formatMinSec,
  formatRole,
  lowestPressure,
  memberNames,
  memberRole,
  nextZustand,
  normalizeTrupp,
  pressureCheckDue,
  remainingSeconds,
  retreatInfo,
  sortTrupps,
  statusFor,
  zustandOf
} from './crew-status';
import { DruckInfo, Trupp, TruppMitglied } from './models';

const start = Date.parse('2026-09-26T10:00:00Z');
const min = 60_000;

function person(personId: string, name: string, startdruckBar: number, druckMessungen: DruckInfo[] = []): TruppMitglied {
  return { personId, name, rolle: 'mitglied', startdruckBar, druckCount: druckMessungen.length, druckMessungen };
}

// Standard: Truppfuehrer A (300 bar) und Truppmann B (280 bar). readings/counts je Mitglied in dieser Reihenfolge,
// extra haengt weitere Truppmaenner an.
interface CrewOptions {
  readings?: DruckInfo[][];
  counts?: number[];
  extra?: TruppMitglied[];
}

function crew(overrides: Partial<Trupp> = {}, options: CrewOptions = {}): Trupp {
  const base = [{ ...person('p1', 'A', 300), rolle: 'fuehrer' as const }, person('p2', 'B', 280), ...(options.extra ?? [])];
  const mitglieder = base.map((m, i) => {
    const druckMessungen = options.readings?.[i] ?? m.druckMessungen;
    return { ...m, druckMessungen, druckCount: options.counts?.[i] ?? druckMessungen.length };
  });
  return normalizeTrupp({
    id: 't1',
    einsatzId: 'e1',
    bezeichnung: 'Angriffstrupp',
    mitglieder,
    startzeit: '2026-09-26T10:00:00Z',
    warnzeitMin: 25,
    maxzeitMin: 30,
    endzeit: null,
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

  it('requests pressure checks at 1/3 and 2/3 until every member has enough readings', () => {
    expect(pressureCheckDue(crew(), start + 9 * min)).toBeNull();
    expect(pressureCheckDue(crew(), start + 10 * min)).toBe(1);
    expect(pressureCheckDue(crew({}, { counts: [1, 0] }), start + 10 * min)).toBe(1);
    expect(pressureCheckDue(crew({}, { counts: [1, 1] }), start + 10 * min)).toBeNull();
    expect(pressureCheckDue(crew({}, { counts: [1, 1] }), start + 20 * min)).toBe(2);
    expect(pressureCheckDue(crew({ endzeit: '2026-09-26T10:05:00Z' }), start + 20 * min)).toBeNull();
  });

  it('keeps the pressure check due until the third member of a larger crew is measured', () => {
    const extra = [person('p3', 'C', 300)];
    expect(pressureCheckDue(crew({}, { extra, counts: [1, 1, 0] }), start + 10 * min)).toBe(1);
    expect(pressureCheckDue(crew({}, { extra, counts: [1, 1, 1] }), start + 10 * min)).toBeNull();
  });

  it('uses the latest reading per person for the lowest pressure', () => {
    expect(lowestPressure(crew())).toBe(280);
    const t = crew(
      {},
      {
        readings: [
          [{ id: 'm2', personId: 'p1', druckBar: 150, zeit: '2026-09-26T10:20:00Z' }],
          [{ id: 'm1', personId: 'p2', druckBar: 200, zeit: '2026-09-26T10:10:00Z' }]
        ]
      }
    );
    expect(lowestPressure(t)).toBe(150);
    expect(lowestPressure(crew({}, { extra: [person('p3', 'C', 300, [{ druckBar: 120, zeit: '2026-09-26T10:20:00Z' }])] }))).toBe(120);
  });

  it('shows pending entries immediately and counts them for pressure checks and alarms', () => {
    const t = crew({}, { readings: [[{ druckBar: 260, zeit: '2026-09-26T10:08:00Z' }]] });
    const [merged] = applyPending(
      [t],
      [
        { id: 'm1', kind: 'druck', truppId: 't1', truppName: 'AT', personId: 'p1', druckBar: 240, zeit: '2026-09-26T10:12:00Z' },
        { id: 'm2', kind: 'druck', truppId: 't1', truppName: 'AT', personId: 'p2', druckBar: 250, zeit: '2026-09-26T10:12:30Z' },
        { id: 'a1', kind: 'event', truppId: 't1', truppName: 'AT', typ: 'warn_ack', zeit: '2026-09-26T10:13:00Z' },
        { id: 'x', kind: 'druck', truppId: 'other', truppName: 'X', personId: 'p1', druckBar: 100, zeit: '2026-09-26T10:13:00Z' }
      ]
    );
    expect(merged.mitglieder[0].druckCount).toBe(2);
    expect(merged.mitglieder[0].druckMessungen.map((m) => [m.druckBar, !!m.pending])).toEqual([[240, true], [260, false]]);
    expect(lowestPressure(merged)).toBe(240);
    expect(pressureCheckDue(merged, start + 10 * min)).toBeNull();
    expect(merged.warnAcked).toBe(true);
    // Das Original bleibt unveraendert.
    expect(t.mitglieder[0].druckCount).toBe(1);
    expect(t.mitglieder[0].druckMessungen).toHaveLength(1);
  });

  it('assigns pending readings to the right member of a larger crew', () => {
    const [merged] = applyPending(
      [crew({}, { extra: [person('p3', 'C', 300)] })],
      [{ id: 'm3', kind: 'druck', truppId: 't1', truppName: 'AT', personId: 'p3', druckBar: 210, zeit: '2026-09-26T10:12:00Z' }]
    );
    expect(merged.mitglieder.map((m) => m.druckCount)).toEqual([0, 0, 1]);
    expect(lowestPressure(merged)).toBe(210);
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
    expect(merged.mitglieder[0].druckCount).toBe(1);
    expect(merged.mitglieder[1].druckMessungen[0]).toEqual(expect.objectContaining({ druckBar: 240, anlass: 'ziel', pending: true }));
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

  it('reads a stored snapshot from the version with two fixed persons', () => {
    const legacy = {
      id: 't1',
      einsatzId: 'e1',
      bezeichnung: 'AT',
      person1Id: 'p1',
      person2Id: 'p2',
      person1Name: 'A',
      person2Name: 'B',
      startdruckPerson1Bar: 300,
      startdruckPerson2Bar: 270,
      druckMessungenPerson1: [{ druckBar: 250, zeit: '2026-09-26T10:10:00Z' }],
      druckMessungenPerson2: [],
      startzeit: '2026-09-26T10:00:00Z',
      warnzeitMin: 25,
      maxzeitMin: 30
    } as unknown as Trupp;
    const t = normalizeTrupp(legacy);
    expect(t.mitglieder.map((m) => [m.personId, m.name, m.rolle, m.startdruckBar, m.druckCount])).toEqual([
      ['p1', 'A', 'fuehrer', 300, 1],
      ['p2', 'B', 'mitglied', 270, 0]
    ]);
    expect(lowestPressure(t)).toBe(250);
    expect(memberNames(t)).toBe('A · B');
  });

  it('names the roles: leader first, members numbered only when there is more than one', () => {
    expect(memberRole(0, 2)).toEqual({ key: 'leader', no: null });
    expect(memberRole(1, 2)).toEqual({ key: 'member', no: null });
    expect(memberRole(2, 4)).toEqual({ key: 'member', no: 2 });
    const translate = (key: string) => ({ 'crewCard.member': 'Truppmann', 'crewCard.memberShort': 'TM' })[key] ?? key;
    expect(formatRole(1, 2, translate)).toBe('Truppmann');
    expect(formatRole(3, 4, translate)).toBe('Truppmann 3');
    expect(formatRole(3, 4, translate, true)).toBe('TM3');
  });

  describe('retreat pressure', () => {
    const at = (m: number) => new Date(start + m * min).toISOString();
    const ziel = (druckBar: number): DruckInfo => ({ druckBar, zeit: at(8), anlass: 'ziel' });
    // Am Ziel nach 8 min: A 300 -> 260, B 280 -> 250. Weitere Messungen je Mitglied ueber readings.
    const working = (overrides: Partial<Trupp> = {}, options: CrewOptions = {}) =>
      crew(
        { zustand: 'arbeit', zustandSeit: at(8), ...overrides },
        { ...options, readings: options.readings ?? [[ziel(260)], [ziel(250)]] }
      );

    it('needs twice the outbound consumption plus the reserve and predicts when it is reached', () => {
      const info = retreatInfo(working(), start + 9 * min)!;
      // A: 300 -> 260 = 40 bar, 2 x 40 + 10 = 90; B: 280 -> 250 = 30 bar, 2 x 30 + 10 = 70
      expect(info.members.map((m) => [m.verbrauchBar, m.rueckzugBar])).toEqual([[40, 90], [30, 70]]);
      expect(info.reached).toBeNull();
      // Hinweg: A 5 bar/min, (260 - 90) / 5 = 34 min nach dem Ziel; B spaeter
      expect(info.etaEpoch).toBe(start + 42 * min);
      expect(info.estimatedReached).toBe(false);
      expect(retreatInfo(working(), start + 42 * min)!.estimatedReached).toBe(true);
      expect(retreatInfo(working({ rueckzugReserveBar: 20 }), start)!.members[0].rueckzugBar).toBe(100);
    });

    it('uses the consumption since reaching the target once a later reading exists', () => {
      const info = retreatInfo(
        working({}, { readings: [[{ druckBar: 200, zeit: at(18) }, ziel(260)], [ziel(250)]] }),
        start + 18 * min
      )!;
      // 6 bar/min seit dem Ziel: (200 - 90) / 6 = 18 min 20 s nach der letzten Messung
      expect(info.etaEpoch).toBe(start + 36 * min + 20_000);
    });

    it('reports the crew member who reached the retreat pressure', () => {
      const info = retreatInfo(
        working({}, { readings: [[ziel(260)], [{ druckBar: 70, zeit: at(30) }, ziel(250)]] }),
        start + 30 * min
      )!;
      expect(info.reached?.personId).toBe('p2');
      expect(info.etaEpoch).toBeNull();
      // Bereits am Ziel zu viel verbraucht: sofort zurueck
      expect(retreatInfo(working({}, { readings: [[ziel(200)], [ziel(250)]] }), start)!.reached?.personId).toBe('p1');
    });

    it('includes every member of a larger crew', () => {
      const info = retreatInfo(
        working({}, { extra: [person('p3', 'C', 300)], readings: [[ziel(260)], [ziel(250)], [ziel(200)]] }),
        start + 9 * min
      )!;
      // C: 300 -> 200 = 100 bar, 2 x 100 + 10 = 210 > 200: Rueckzug sofort
      expect(info.members.map((m) => m.rueckzugBar)).toEqual([90, 70, 210]);
      expect(info.reached?.personId).toBe('p3');
      expect(info.missing).toBe(false);
    });

    it('falls back to the first reading at the target and flags crews without one', () => {
      const skipped = working(
        {},
        {
          readings: [
            [
              { druckBar: 240, zeit: at(15) },
              { druckBar: 250, zeit: at(12) },
              { druckBar: 280, zeit: at(5) }
            ],
            []
          ]
        }
      );
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
