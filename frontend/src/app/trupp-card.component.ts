import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, input, OnDestroy, output, signal } from '@angular/core';
import {
  elapsedSeconds,
  formatMinSec,
  lowestPressure,
  nextZustand,
  pressureCheckDue,
  pressureCheckFraction,
  remainingSeconds,
  retreatInfo,
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
  // Rueckzugsdruck dieser Person (nur am Ziel) und ob er erreicht ist
  retreatBar: number | null;
  retreatReached: boolean;
}

// Aufbau: Kopf (Status, Trupp, Zeit), je Geraetetraeger eine Zeile mit aktuellem Druck und Verlauf, unten Aktionen.
@Component({
  selector: 'app-trupp-card',
  imports: [DatePipe, UpperCasePipe],
  host: {
    class: 'trupp trupp--stack crew-card',
    '[attr.data-status]': 'status()',
    '[attr.data-mayday]': "trupp().maydayAktiv ? 'aktiv' : null"
  },
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
          @if (retreat(); as r) {
            @if (r.etaEpoch && !r.estimatedReached) {
              <span class="muted">{{ i18n.t('retreat.eta', { time: (r.etaEpoch | date: 'HH:mm') ?? '' }) }}</span>
            }
            @if (r.missing) {
              <span class="muted">{{ i18n.t('retreat.missing') }}</span>
            }
          }
        </div>
      </div>
      <div class="crew-card__time">
        <div class="crew-card__time-value">{{ timeDisplay() }}</div>
        <div class="muted">{{ trupp().endzeit ? i18n.t('dashboard.duration') : i18n.t('dashboard.remainingTime') }}</div>
      </div>
    </header>

    @if (trupp().maydayAktiv) {
      <div class="crew-mayday" role="alert">
        <div class="crew-mayday__text">
          <strong>MAYDAY</strong>
          <span>{{ i18n.t('mayday.since', { time: (trupp().maydaySeit | date: 'HH:mm:ss') ?? '' }) }}</span>
          @if (trupp().maydayPosition) {
            <span>{{ i18n.t('mayday.position') }}: {{ trupp().maydayPosition }}</span>
          }
          @if (trupp().maydayRestdruck !== null && trupp().maydayRestdruck !== undefined) {
            <span>{{ i18n.t('mayday.pressure') }}: {{ trupp().maydayRestdruck }} bar</span>
          }
          @if (trupp().maydayFunkspruch) {
            <span>„{{ trupp().maydayFunkspruch }}“</span>
          }
        </div>
        @if (trupp().maydayPending) {
          <div class="crew-mayday__offline">{{ i18n.t('mayday.notSent') }}</div>
        }
        <div class="crew-mayday__actions">
          <button class="ghost" type="button" (click)="maydayInfo.emit()">{{ i18n.t('mayday.addInfo') }}</button>
          <button class="ghost" type="button" (click)="maydayEnd.emit()">{{ i18n.t('mayday.end') }}</button>
        </div>
      </div>
    }

    @if (trupp().endPending) {
      <div class="pending-note" role="status">{{ i18n.t('outbox.endPending') }}</div>
    }
    @if (retreat()?.reached) {
      <div class="retreat-due retreat-due--reached" role="alert">{{ i18n.t('retreat.reached') }}</div>
    } @else if (retreat()?.estimatedReached) {
      <div class="retreat-due" role="status">{{ i18n.t('retreat.estimated') }}</div>
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
            @if (p.retreatBar !== null) {
              <span class="crew-member__retreat" [class.crew-member__retreat--reached]="p.retreatReached">
                {{ i18n.t('retreat.at', { value: p.retreatBar }) }}
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
      @if (!trupp().endzeit && !trupp().maydayAktiv) {
        <!-- Eine Sekunde halten statt Rueckfrage: im Notfall schnell, aber nicht durch einen versehentlichen Tipp -->
        <button
          class="mayday-hold"
          type="button"
          [class.mayday-hold--active]="holding()"
          [attr.aria-label]="i18n.t('mayday.holdAria')"
          (pointerdown)="startHold()"
          (pointerup)="cancelHold()"
          (pointerleave)="cancelHold()"
          (pointercancel)="cancelHold()"
          (keydown.space)="$event.preventDefault(); startHold()"
          (keyup.space)="cancelHold()"
          (keydown.enter)="$event.preventDefault(); startHold()"
          (keyup.enter)="cancelHold()"
          (contextmenu)="$event.preventDefault()"
        >
          <span class="mayday-hold__fill" aria-hidden="true"></span>
          <span class="mayday-hold__label">{{ i18n.t('mayday.hold') }}</span>
        </button>
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
            <button
              class="primary"
              type="button"
              [class.btn-attention]="retreat()?.reached || retreat()?.estimatedReached"
              (click)="zustandChange.emit('rueckweg')"
            >
              {{ i18n.t('crewState.step_rueckweg') }}
            </button>
          }
          @default {
            <button class="primary" type="button" (click)="end.emit()">{{ i18n.t('crewState.step_beendet') }}</button>
          }
        }
      </div>
    }
  `
})
export class TruppCardComponent implements OnDestroy {
  readonly i18n = inject(TranslationService);
  readonly trupp = input.required<Trupp>();
  readonly now = input.required<number>();
  readonly pressure = output<string>();
  readonly end = output<void>();
  readonly zustandChange = output<'arbeit' | 'rueckweg'>();
  readonly protokoll = output<void>();
  readonly mayday = output<void>();
  readonly maydayInfo = output<void>();
  readonly maydayEnd = output<void>();
  // Mayday-Knopf wird gerade gehalten (Fortschrittsbalken laeuft).
  readonly holding = signal(false);
  private holdTimer?: number;
  static readonly maydayHoldMs = 1000;
  // Wie im Backend: Schutz vor Fehleingaben.
  readonly maxReadings = 20;

  readonly status = computed(() => statusFor(this.trupp(), this.now()));
  readonly pressureStage = computed(() => pressureCheckDue(this.trupp(), this.now()));
  readonly fraction = pressureCheckFraction;
  readonly zustand = computed<TruppZustand>(() => zustandOf(this.trupp()));
  readonly next = computed(() => nextZustand(this.trupp()));
  readonly stateSince = computed(() => this.trupp().zustandSeit ?? this.trupp().startzeit);
  readonly retreat = computed(() => retreatInfo(this.trupp(), this.now()));

  // Der Trupp richtet sich nach dem Geraet mit dem niedrigsten Druck: diese Person wird hervorgehoben.
  readonly members = computed<CrewMember[]>(() => {
    const t = this.trupp();
    const lowest = lowestPressure(t);
    const retreat = this.retreat();
    const member = (id: string, role: 'P1' | 'P2', name: string, start: number, newestFirst: DruckInfo[], count: number) => {
      const current = newestFirst[0]?.druckBar ?? start;
      const r = retreat?.members.find((m) => m.personId === id);
      return {
        id,
        role,
        name,
        start,
        current,
        readings: newestFirst.slice(0, 3).reverse(),
        count,
        lowest: current === lowest,
        retreatBar: r?.rueckzugBar ?? null,
        retreatReached: r?.reached ?? false
      };
    };
    const p1 = member(t.person1Id, 'P1', t.person1Name, t.startdruckPerson1Bar, t.druckMessungenPerson1, t.druckCountPerson1);
    const p2 = member(t.person2Id, 'P2', t.person2Name, t.startdruckPerson2Bar, t.druckMessungenPerson2, t.druckCountPerson2);
    // Bei gleichem Druck niemanden hervorheben.
    if (p1.current === p2.current) {
      p1.lowest = p2.lowest = false;
    }
    return [p1, p2];
  });

  startHold(): void {
    if (this.holdTimer !== undefined) {
      return;
    }
    this.holding.set(true);
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = undefined;
      this.holding.set(false);
      this.mayday.emit();
    }, TruppCardComponent.maydayHoldMs);
  }

  cancelHold(): void {
    window.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.holding.set(false);
  }

  ngOnDestroy(): void {
    this.cancelHold();
  }

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
