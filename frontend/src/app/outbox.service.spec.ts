import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OutboxItem, OutboxService } from './outbox.service';

const STORAGE_KEY = 'crewtrace_outbox_abc123';

function reading(id: string, druckBar = 250): OutboxItem {
  return {
    id,
    kind: 'druck',
    truppId: 't1',
    truppName: 'Angriffstrupp',
    personId: 'p1',
    personName: 'Muster',
    druckBar,
    zeit: '2026-09-26T10:05:00.000Z'
  };
}

// Laesst ausstehende Promise-Callbacks (await im Service) laufen.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('OutboxService', () => {
  let outbox: OutboxService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    outbox = TestBed.inject(OutboxService);
    http = TestBed.inject(HttpTestingController);
    outbox.start('ABC123');
  });

  afterEach(() => {
    outbox.stop();
    http.verify();
  });

  it('sends immediately with client id and capture time when nothing is queued', async () => {
    const result = outbox.submit(reading('m1'));
    const req = http.expectOne('/api/trupps/t1/druckmessungen');
    expect(req.request.body).toEqual({ personId: 'p1', druckBar: 250, id: 'm1', zeit: '2026-09-26T10:05:00.000Z' });
    req.flush({});

    expect(await result).toEqual({ status: 'sent' });
    expect(outbox.waiting().length).toBe(0);
    // Bleibt eingeblendet, bis die Serverdaten neu geladen sind.
    expect(outbox.pending().length).toBe(1);
    outbox.clearSent();
    expect(outbox.pending().length).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the entry stored when the network fails and sends it on the next flush', async () => {
    const result = outbox.submit(reading('m1'));
    http.expectOne('/api/trupps/t1/druckmessungen').error(new ProgressEvent('error'), { status: 0 });

    expect(await result).toEqual({ status: 'queued' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[0].id).toBe('m1');

    const flushed = outbox.flush();
    http.expectOne('/api/trupps/t1/druckmessungen').flush({});
    await flushed;
    expect(outbox.waiting().length).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns a direct rejection to the caller instead of queueing it', async () => {
    const result = outbox.submit(reading('m1', 999));
    http.expectOne('/api/trupps/t1/druckmessungen').flush({ error: 'Druck muss zwischen 1 und 300 bar liegen.' }, { status: 400, statusText: 'Bad Request' });

    expect(await result).toEqual({ status: 'rejected', error: 'Druck muss zwischen 1 und 300 bar liegen.' });
    expect(outbox.pending().length).toBe(0);
    expect(outbox.failed().length).toBe(0);
  });

  it('sends queued entries in order, lists rejected ones and continues with the rest', async () => {
    const first = outbox.submit(reading('m1'));
    http.expectOne('/api/trupps/t1/druckmessungen').error(new ProgressEvent('error'), { status: 0 });
    await first;
    expect(await outbox.submit(reading('m2', 999))).toEqual({ status: 'queued' });
    expect(await outbox.submit(reading('m3', 200))).toEqual({ status: 'queued' });
    await settle();

    // Ein Flush laeuft bereits aus submit(); die Reihenfolge bleibt m1, m2, m3.
    const reqs = () => http.match('/api/trupps/t1/druckmessungen');
    let open = reqs();
    expect(open.map((r) => r.request.body.id)).toEqual(['m1']);
    open[0].flush({});
    await settle();
    open = reqs();
    expect(open[0].request.body.id).toBe('m2');
    open[0].flush({ error: 'abgelehnt' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    open = reqs();
    expect(open[0].request.body.id).toBe('m3');
    open[0].flush({});
    await settle();

    expect(outbox.waiting().length).toBe(0);
    expect(outbox.failed().map((i) => [i.id, i.error])).toEqual([['m2', 'abgelehnt']]);
    outbox.discard('m2');
    expect(outbox.failed().length).toBe(0);
  });

  it('stops at a server error and keeps the order for the retry', async () => {
    const result = outbox.submit(reading('m1'));
    http.expectOne('/api/trupps/t1/druckmessungen').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(await result).toEqual({ status: 'queued' });
    expect(outbox.waiting().map((i) => i.id)).toEqual(['m1']);
  });

  it('restores stored entries after a reload (new service instance)', async () => {
    const result = outbox.submit(reading('m1'));
    http.expectOne('/api/trupps/t1/druckmessungen').error(new ProgressEvent('error'), { status: 0 });
    await result;
    outbox.stop();

    outbox.start('ABC123');
    expect(outbox.waiting().map((i) => i.id)).toEqual(['m1']);
    http.expectOne('/api/trupps/t1/druckmessungen').flush({});
    await settle();
    expect(outbox.waiting().length).toBe(0);
  });

  it('sends crew end and alarm events with their capture time', async () => {
    const end = outbox.submit({ id: 'e1', kind: 'end', truppId: 't1', truppName: 'AT', zeit: '2026-09-26T10:20:00.000Z' });
    const endReq = http.expectOne('/api/trupps/t1/beenden');
    expect(endReq.request.body).toEqual({ endzeit: '2026-09-26T10:20:00.000Z' });
    endReq.flush({});
    await end;

    const ack = outbox.submit({ id: 'a1', kind: 'event', truppId: 't1', truppName: 'AT', typ: 'warn_ack', zeit: '2026-09-26T10:21:00.000Z' });
    const ackReq = http.expectOne('/api/trupps/t1/events');
    expect(ackReq.request.body).toEqual({ typ: 'warn_ack', id: 'a1', zeit: '2026-09-26T10:21:00.000Z' });
    ackReq.flush({});
    await ack;
  });
});
