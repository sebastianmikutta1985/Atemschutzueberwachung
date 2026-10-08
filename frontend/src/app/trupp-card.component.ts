import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import {
  elapsedSeconds,
  formatMinSec,
  lowestPressure,
  nextZustand,
  pressureCheckDue,
  pressureCheckFraction,
  remainingSeconds,
  statusFor,
  zustandOf
} from './crew-status';
import { DruckInfo, Trupp, TruppZustand } from './models';
import { TranslationService } from './translation.service';

interface CrewMember {
  id: string;
  role: 'P1' | 'P2';
  name: string;
  start: number;
  current: number;
  // Letzte Messungen in zeitlicher Reihenfolge (aelteste zuerst), damit der Druckverlauf lesbar ist.
  readings: DruckInfo[];
  count: number;
  lowest: boolean;
}

// Aufbau: Kopf (Status, Trupp, Zeit), je Geraetetraeger eine Zeile mit aktuellem Druck und Verlauf, unten Aktionen.
@Component({
  selector: 'app-trupp-card',
  imports: [DatePipe, UpperCasePipe],
  host: { class: 'trupp trupp--stack crew-card', '[attr.data-status]': 'status()' },
  template: `
    <header class="crew-card__head">
      <div class="crew-card__heading">
        <span class="trupp__status" [attr.data-status]="status()">{{ statusLabel() | uppercase }}</span>
        <h3 class="crew-card__title">{{ trupp().bezeichnung }}</h3>
        <div class="crew-card__sub">
          <span class="crew-state" [attr.data-state]="zustand()">
            {{ i18n.t('crewState.' + zustand()) }}@if (zustand() !== 'beendet') { · {{ i18n.t('crewState.since', { time: (stateSince() | date: 'HH:mm') ?? '' }) }}}@if (trupp().zustandPending) { · {{ i18n.t('outbox.pendingShort') }}}
          </span>
          <span class="muted">{{ i18n.t('dashboard.start') }} {{ trupp().startzeit | date: 'HH:mm' }}</span>
        </div>
      </div>
      <div class="crew-card__time">
        <div class="crew-card__time-value">{{ timeDisplay() }}</div>
        <div class="muted">{{ trupp().endzeit ? i18n.t('dashboard.duration') : i18n.t('dashboard.remainingTime') }}</div>
      </div>
    </header>

    @if (trupp().endPending) {
      <div class="pending-note" role="status">{{ i18n.t('outbox.endPending') }}</div>
    }
    @if (pressureStage(); as stage) {
      <div class="pressure-due" role="status">{{ i18n.t('dashboard.pressureCheckDue', { fraction: fraction(stage) }) }}</div>
    }

    <div class="crew-card__people">
      @for (p of members(); track p.id) {
        <div class="crew-member" [class.crew-member--lowest]="p.lowest">
          <div class="crew-member__line">
            <span class="crew-member__role">{{ p.role }}</span>
            <span class="crew-member__name">{{ p.name }}</span>
            <span class="crew-member__pressure">{{ p.current }} bar</span>
          </div>
          <div class="crew-member__history">
            <span>{{ i18n.t('crewCard.startShort') }} {{ p.start }}</span>
            @for (m of p.readings; track $index) {
              <span class="crew-member__reading" [class.pending]="m.pending">
                → {{ m.druckBar }}
                <span class="muted">({{ m.zeit | date: 'HH:mm' }}@if (m.anlass === 'ziel') {, {{ i18n.t('crewState.atTarget') }}}@if (m.pending) {, {{ i18n.t('outbox.pendingShort') }}})</span>
              </span>
            }
          </div>
        </div>
      }
    </div>

    <div class="trupp__links">
      <button class="link-button" type="button" (click)="protokoll.emit()">{{ i18n.t('protocol.open') }}</button>
      @if (zustand() === 'anmarsch') {
        <!-- Abbruch vor Erreichen des Ziels: direkt in den Rueckweg -->
        <button class="link-button" type="button" (click)="zustandChange.emit('rueckweg')">{{ i18n.t('crewState.abort') }}</button>
      }
    </div>
    @if (!trupp().endzeit) {
      <div class="trupp__bottom">
        @for (p of members(); track p.id) {
          <button
            class="ghost"
            type="button"
            (click)="pressure.emit(p.id)"
            [disabled]="p.count >= maxReadings"
            [class.btn-attention]="(pressureStage() ?? 0) > p.count"
          >
            {{ i18n.t(p.role === 'P1' ? 'dashboard.pressureP1Button' : 'dashboard.pressureP2Button', { count: p.count }) }}
          </button>
        }
        @switch (next()) {
          @case ('arbeit') {
            <button class="primary" type="button" (click)="zustandChange.emit('arbeit')">{{ i18n.t('crewState.step_arbeit') }}</button>
          }
          @case ('rueckweg') {
            <button class="primary" type="button" (click)="zustandChange.emit('rueckweg')">{{ i18n.t('crewState.step_rueckweg') }}</button>
          }
          @default {
            <button class="primary" type="button" (click)="end.emit()">{{ i18n.t('crewState.step_beendet') }}</button>
          }
        }
      </div>
    }
  `
})
export class TruppCardComponent {
  readonly i18n = inject(TranslationService);
  readonly trupp = input.required<Trupp>();
  readonly now = input.required<number>();
  readonly pressure = output<string>();
  readonly end = output<void>();
  readonly zustandChange = output<'arbeit' | 'rueckweg'>();
  readonly protokoll = output<void>();
  // Wie im Backend: Schutz vor Fehleingaben.
  readonly maxReadings = 20;

  readonly status = computed(() => statusFor(this.trupp(), this.now()));
  readonly pressureStage = computed(() => pressureCheckDue(this.trupp(), this.now()));
  readonly fraction = pressureCheckFraction;
  readonly zustand = computed<TruppZustand>(() => zustandOf(this.trupp()));
  readonly next = computed(() => nextZustand(this.trupp()));
  readonly stateSince = computed(() => this.trupp().zustandSeit ?? this.trupp().startzeit);

  // Der Trupp richtet sich nach dem Geraet mit dem niedrigsten Druck: diese Person wird hervorgehoben.
  readonly members = computed<CrewMember[]>(() => {
    const t = this.trupp();
    const lowest = lowestPressure(t);
    const member = (id: string, role: 'P1' | 'P2', name: string, start: number, newestFirst: DruckInfo[], count: number) => {
      const current = newestFirst[0]?.druckBar ?? start;
      return { id, role, name, start, current, readings: newestFirst.slice(0, 3).reverse(), count, lowest: current === lowest };
    };
    const p1 = member(t.person1Id, 'P1', t.person1Name, t.startdruckPerson1Bar, t.druckMessungenPerson1, t.druckCountPerson1);
    const p2 = member(t.person2Id, 'P2', t.person2Name, t.startdruckPerson2Bar, t.druckMessungenPerson2, t.druckCountPerson2);
    // Bei gleichem Druck niemanden hervorheben.
    if (p1.current === p2.current) {
      p1.lowest = p2.lowest = false;
    }
    return [p1, p2];
  });

  readonly timeDisplay = computed(() => {
    const trupp = this.trupp();
    return trupp.endzeit
      ? formatMinSec(elapsedSeconds(trupp, this.now()))
      : formatMinSec(remainingSeconds(trupp, this.now()));
  });

  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'gruen':
        return this.i18n.t('dashboard.statusGreen');
      case 'gelb':
        return this.i18n.t('dashboard.statusYellow');
      case 'rot':
        return this.i18n.t('dashboard.statusRed');
      default:
        return this.i18n.t('dashboard.statusFinished');
    }
  });
}
