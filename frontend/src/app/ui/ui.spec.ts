import { Component, signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConnectionIndicatorComponent, LiveStatus } from './connection-indicator.component';
import { CountdownComponent } from './countdown.component';
import { DialogComponent } from './dialog.component';
import { DruckAnzeigeComponent } from './druck-anzeige.component';
import { StatusBadgeComponent } from './status-badge.component';
import { DisplayStatus } from '../crew/display-status';

function render<T>(component: Type<T>, inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(component);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('UI building blocks', () => {
  beforeEach(() => {
    localStorage.setItem('crewtrace_lang', 'de');
  });

  it('status badge always shows icon and text, colour comes from data-status', () => {
    const cases: [DisplayStatus, string][] = [
      ['ok', 'OK'],
      ['rueckzug', 'Rückzug'],
      ['ueberfaellig', 'Überfällig'],
      ['funkausfall', 'Kein Funk'],
      ['mayday', 'Mayday'],
      ['beendet', 'Beendet']
    ];
    for (const [status, text] of cases) {
      const el = render(StatusBadgeComponent, { status });
      expect(el.getAttribute('data-status')).toBe(status);
      expect(el.querySelector('svg')).toBeTruthy();
      expect(el.textContent?.trim()).toBe(text);
    }
  });

  it('countdown formats seconds as m:ss and exposes a machine-readable duration', () => {
    const el = render(CountdownComponent, { seconds: 754, label: 'Restzeit' });
    const time = el.querySelector('time')!;
    expect(time.textContent?.trim()).toBe('12:34');
    expect(time.getAttribute('datetime')).toBe('PT12M34S');
    expect(time.getAttribute('aria-label')).toBe('Restzeit 12:34');
  });

  it('pressure display fills the bar relative to the start pressure and marks the retreat pressure', () => {
    const el = render(DruckAnzeigeComponent, { name: 'Lea Wagner', value: 150, start: 300, retreat: 150, retreatReached: true });
    const meter = el.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('150');
    expect(meter.getAttribute('aria-valuemax')).toBe('300');
    expect((el.querySelector('.druck__fill') as HTMLElement).style.width).toBe('50%');
    expect((el.querySelector('.druck__mark') as HTMLElement).style.left).toBe('50%');
    expect(el.classList).toContain('druck--retreat');
  });

  it('connection indicator treats a lost connection as offline and shows the snapshot time', () => {
    const el = render(ConnectionIndicatorComponent, {
      status: 'connecting' satisfies LiveStatus,
      lost: true,
      snapshotFrom: '2026-10-09T18:30:00'
    });
    expect(el.getAttribute('data-state')).toBe('disconnected');
    expect(el.textContent).toContain('Offline');
    expect(el.textContent).toContain('Stand 18:30');
  });
});

@Component({
  imports: [DialogComponent],
  template: `
    @if (open()) {
      <app-dialog heading="Druck messen" [closable]="closable" (close)="closed = closed + 1">
        <input id="first" />
        <div dialog-actions class="dialog__actions">
          <button id="last" type="button">OK</button>
        </div>
      </app-dialog>
    }
  `
})
class DialogHost {
  readonly open = signal(true);
  closable = true;
  closed = 0;
}

describe('DialogComponent', () => {
  it('is labelled by its heading, focuses the first field and closes on Escape', async () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('[role="dialog"]')!;
    const title = el.querySelector('.dialog__title')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.textContent).toBe('Druck messen');
    expect(document.activeElement?.id).toBe('first');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('ignores Escape and the backdrop when it must not be closed (alarms)', () => {
    const fixture = TestBed.createComponent(DialogHost);
    fixture.componentInstance.closable = false;
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (el.querySelector('.modal__backdrop') as HTMLElement).click();
    expect(fixture.componentInstance.closed).toBe(0);
    expect(el.querySelector('button[aria-label]')).toBeNull();
  });
});
