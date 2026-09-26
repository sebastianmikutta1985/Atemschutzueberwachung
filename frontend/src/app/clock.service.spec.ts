import { ClockService } from './clock.service';

describe('ClockService', () => {
  const localNow = Date.parse('2026-09-26T10:00:00.000Z');

  it('corrects a device clock that is five minutes behind the server', () => {
    const clock = new ClockService();
    const serverDate = new Date(localNow + 5 * 60_000).toUTCString();

    clock.sync(serverDate, localNow - 100, localNow + 100);

    expect(clock.offsetMs()).toBeGreaterThan(5 * 60_000 - 1000);
    expect(clock.offsetMs()).toBeLessThan(5 * 60_000 + 1000);
  });

  it('ignores deviations below the one-second resolution of the Date header', () => {
    const clock = new ClockService();
    const serverDate = new Date(localNow).toUTCString();

    clock.sync(serverDate, localNow - 50, localNow + 50);

    expect(clock.offsetMs()).toBe(0);
  });

  it('keeps the previous offset when the header is missing or invalid', () => {
    const clock = new ClockService();
    clock.sync(new Date(localNow - 10 * 60_000).toUTCString(), localNow, localNow);
    const before = clock.offsetMs();

    clock.sync(null, localNow, localNow);
    clock.sync('kein Datum', localNow, localNow);

    expect(clock.offsetMs()).toBe(before);
    expect(before).toBeLessThan(0);
  });
});
