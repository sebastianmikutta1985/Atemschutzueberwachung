import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, OnDestroy, output, signal } from '@angular/core';
import {
  elapsedSeconds,
  lowestPressure,
  nextZustand,
  pressureCheckDue,
  pressureCheckFraction,
  remainingSeconds,
  retreatInfo,
  zustandOf
} from '../crew-status';
import { DruckInfo, Trupp, TruppZustand } from '../models';
import { ButtonComponent } from '../ui/button.component';
import { CountdownComponent } from '../ui/countdown.component';
import { DruckAnzeigeComponent } from '../ui/druck-anzeige.component';
import { IconComponent, IconName } from '../ui/icon.component';
import { StatusBadgeComponent } from '../ui/status-badge.component';
import { TranslatePipe } from '../ui/translate.pipe';
import { displayStatus } from './display-status';

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

const STATE_ICON: Record<TruppZustand, IconName> = {
  anmarsch: 'arrow-right',
  arbeit: 'target',
  rueckweg: 'arrow-return',
  beendet: 'check-circle'
};

let nextId = 0;

// Trupp-Karte, immer gleich aufgebaut: Kopf (Trupp, Status), Restzeit gross, Hinweise, Druck je Geraetetraeger,
// unten die Aktionen. Rahmen und Streifen tragen die Statusfarbe. Nur Inputs/Outputs, keine Services.
@Component({
  selector: 'app-trupp-karte',
  imports: [DatePipe, ButtonComponent, CountdownComponent, DruckAnzeigeComponent, IconComponent, StatusBadgeComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'karte',
    role: 'group',
    '[attr.aria-labelledby]': 'titleId',
    '[attr.data-status]': 'status()'
  },
  template: `
    <header class="karte__head">
      <div class="karte__heading">
        <h3 class="karte__title" [id]="titleId">{{ trupp().bezeichnung }}</h3>
        <p class="karte__state" [attr.data-state]="zustand()">
          <app-icon [name]="stateIcon()" size="sm" />
          <span>
            {{ 'crewState.' + zustand() | t }}@if (zustand() !== 'beendet') {
              · {{ 'crewState.since' | t: { time: (stateSince() | date: 'HH:mm') ?? '' } }}
            }
          </span>
          @if (trupp().zustandPending) {
            <span class="karte__pending"><app-icon name="pending" size="sm" />{{ 'outbox.pendingShort' | t }}</span>
          }
        </p>
      </div>
      <app-status-badge [status]="status()" size="lg" />
    </header>

    <div class="karte__time">
      <app-countdown
        [seconds]="seconds()"
        [label]="(trupp().endzeit ? 'ui.duration' : 'ui.remaining') | t"
        [tone]="timeTone()"
      />
      <dl class="karte__facts">
        <div>
          <dt>{{ 'dashboard.start' | t }}</dt>
          <dd><time>{{ trupp().startzeit | date: 'HH:mm' }}</time></dd>
        </div>
        @if (retreat()?.etaEpoch && !retreat()?.estimatedReached) {
          <div>
            <dt>{{ 'retreat.etaShort' | t }}</dt>
            <dd><time>{{ retreat()!.etaEpoch | date: 'HH:mm' }}</time></dd>
          </div>
        }
      </dl>
    </div>

    @if (trupp().maydayAktiv) {
      <div class="karte__mayday" role="alert">
        <p class="karte__mayday-title">
          <app-icon name="alert-octagon" />
          <strong>MAYDAY</strong>
          <span>{{ 'mayday.since' | t: { time: (trupp().maydaySeit | date: 'HH:mm:ss') ?? '' } }}</span>
        </p>
        @if (trupp().maydayPosition) {
          <p>{{ 'mayday.position' | t }}: {{ trupp().maydayPosition }}</p>
        }
        @if (trupp().maydayRestdruck !== null && trupp().maydayRestdruck !== undefined) {
          <p>{{ 'mayday.pressure' | t }}: {{ trupp().maydayRestdruck }} bar</p>
        }
        @if (trupp().maydayFunkspruch) {
          <p>„{{ trupp().maydayFunkspruch }}“</p>
        }
        @if (trupp().maydayPending) {
          <p class="karte__mayday-offline">{{ 'mayday.notSent' | t }}</p>
        }
        <div class="karte__mayday-actions">
          <button appButton type="button" (click)="maydayInfo.emit()">{{ 'mayday.addInfo' | t }}</button>
          <button appButton type="button" (click)="maydayEnd.emit()">{{ 'mayday.end' | t }}</button>
        </div>
      </div>
    }

    @if (hints().length) {
      <ul class="karte__hints">
        @for (h of hints(); track h.key) {
          <li class="hint" [attr.data-tone]="h.tone" [attr.role]="h.tone === 'crit' ? 'alert' : 'status'">
            <app-icon [name]="h.icon" size="sm" />
            <span>{{ h.key | t: h.params }}</span>
          </li>
        }
      </ul>
    }

    <div class="karte__people">
      @for (p of members(); track p.id) {
        <div class="karte__member">
          <app-druck-anzeige
            [role]="p.role"
            [name]="p.name"
            [value]="p.current"
            [start]="p.start"
            [retreat]="p.retreatBar"
            [retreatReached]="p.retreatReached"
            [lowest]="p.lowest"
          />
          <p class="karte__history">
            <span>{{ 'crewCard.startShort' | t }} {{ p.start }}</span>
            @for (m of p.readings; track $index) {
              <span [class.karte__reading--pending]="m.pending">
                → {{ m.druckBar }}
                <span class="karte__reading-meta">({{ m.zeit | date: 'HH:mm' }}@if (m.anlass === 'ziel') {, {{ 'crewState.atTarget' | t }}}@if (m.pending) {, {{ 'outbox.pendingShort' | t }}})</span>
              </span>
            }
            @if (p.retreatBar !== null) {
              <span class="karte__retreat" [class.karte__retreat--reached]="p.retreatReached">
                {{ 'retreat.at' | t: { value: p.retreatBar } }}
              </span>
            }
          </p>
        </div>
      }
    </div>

    @if (!trupp().endzeit) {
      <div class="karte__actions">
        <div class="karte__druck">
          @for (p of members(); track p.id) {
            <button
              appButton
              type="button"
              size="lg"
              icon="gauge"
              [attention]="(pressureStage() ?? 0) > p.count"
              [disabled]="p.count >= maxReadings"
              (click)="pressure.emit(p.id)"
            >
              {{ (p.role === 'P1' ? 'dashboard.pressureP1Button' : 'dashboard.pressureP2Button') | t: { count: p.count } }}
            </button>
          }
        </div>
        @switch (next()) {
          @case ('arbeit') {
            <button appButton variant="primary" size="lg" icon="target" [block]="true" type="button" (click)="zustandChange.emit('arbeit')">
              {{ 'crewState.step_arbeit' | t }}
            </button>
          }
          @case ('rueckweg') {
            <button
              appButton
              [variant]="retreatDue() ? 'warn' : 'primary'"
              size="lg"
              icon="arrow-return"
              [block]="true"
              type="button"
              (click)="zustandChange.emit('rueckweg')"
            >
              {{ 'crewState.step_rueckweg' | t }}
            </button>
          }
          @default {
            <button appButton variant="primary" size="lg" icon="check-circle" [block]="true" type="button" (click)="end.emit()">
              {{ 'crewState.step_beendet' | t }}
            </button>
          }
        }
      </div>
    }

    <div class="karte__secondary">
      <button appButton variant="ghost" icon="list" type="button" (click)="protokoll.emit()">{{ 'protocol.open' | t }}</button>
      @if (zustand() === 'anmarsch') {
        <!-- Abbruch vor Erreichen des Ziels: direkt in den Rueckweg -->
        <button appButton variant="ghost" icon="arrow-return" type="button" (click)="zustandChange.emit('rueckweg')">
          {{ 'crewState.abort' | t }}
        </button>
      }
      @if (!trupp().endzeit && !trupp().maydayAktiv) {
        <!-- Eine Sekunde halten statt Rueckfrage: im Notfall schnell, aber nicht durch einen versehentlichen Tipp -->
        <button
          class="mayday-hold"
          type="button"
          [class.mayday-hold--active]="holding()"
          [attr.aria-label]="'mayday.holdAria' | t"
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
          <app-icon class="mayday-hold__icon" name="alert-octagon" size="sm" />
          <span class="mayday-hold__label">{{ 'mayday.hold' | t }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      --karte-accent: var(--border-strong);
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      min-width: 0;
      padding: var(--space-4);
      padding-top: calc(var(--space-4) + var(--space-2));
      background: var(--surface);
      border: var(--border-w) solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-1);
      overflow: hidden;
    }
    /* Statusstreifen oben */
    :host::before {
      content: '';
      position: absolute;
      inset: 0 0 auto 0;
      height: var(--space-2);
      background: var(--karte-accent);
    }
    :host([data-status='ok']) {
      --karte-accent: var(--status-ok-solid);
    }
    :host([data-status='rueckzug']) {
      --karte-accent: var(--status-warn-solid);
      border-color: var(--status-warn-solid);
    }
    :host([data-status='ueberfaellig']),
    :host([data-status='mayday']) {
      --karte-accent: var(--status-crit-solid);
      border-color: var(--status-crit-solid);
      border-width: calc(var(--border-w) * 2);
      animation: karte-pulse var(--dur-pulse) ease-in-out infinite;
    }
    :host([data-status='funkausfall']) {
      --karte-accent: var(--status-radio-solid);
      border-color: var(--status-radio-solid);
      border-width: calc(var(--border-w) * 2);
    }
    :host([data-status='beendet']) {
      --karte-accent: var(--status-neutral-solid);
      background: var(--surface-sunken);
      box-shadow: none;
    }
    @keyframes karte-pulse {
      0%,
      100% {
        box-shadow: 0 0 0 0 var(--karte-accent);
      }
      50% {
        box-shadow: 0 0 0 var(--space-2) color-mix(in srgb, var(--karte-accent) 35%, transparent);
      }
    }

    .karte__head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-2) var(--space-3);
    }
    .karte__heading {
      display: grid;
      flex: 1 1 auto;
      gap: var(--space-1);
      min-width: 0;
    }
    .karte__title {
      font-size: var(--fs-xl);
      font-weight: var(--fw-heavy);
      overflow-wrap: break-word;
    }
    .karte__state {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
      margin: 0;
      font-size: var(--fs-sm);
      font-weight: var(--fw-semibold);
      color: var(--text-muted);
    }
    .karte__pending {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      color: var(--status-warn-fg);
      font-weight: var(--fw-bold);
    }

    .karte__time {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .karte__time app-countdown {
      order: 2;
    }
    .karte__facts {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .karte__facts div {
      display: grid;
    }
    .karte__facts dt {
      font-size: var(--fs-xs);
      font-weight: var(--fw-bold);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: var(--tracking-caps);
    }
    .karte__facts dd {
      margin: 0;
      font-size: var(--fs-lg);
      font-weight: var(--fw-bold);
    }

    .karte__mayday {
      display: grid;
      gap: var(--space-1);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--status-crit-solid);
      color: var(--status-crit-on);
      font-weight: var(--fw-semibold);
    }
    .karte__mayday p {
      margin: 0;
    }
    .karte__mayday-title {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--fs-lg);
    }
    .karte__mayday-title strong {
      letter-spacing: var(--tracking-caps);
    }
    .karte__mayday-offline {
      justify-self: start;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--status-crit-on);
      color: var(--status-crit-solid);
      font-weight: var(--fw-heavy);
    }
    .karte__mayday-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--touch-gap);
      margin-top: var(--space-2);
    }
    .karte__mayday-actions button {
      --btn-bg: transparent;
      --btn-fg: var(--status-crit-on);
      --btn-border: var(--status-crit-on);
      flex: 1 1 auto;
    }

    .karte__hints {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .hint {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      border-left: var(--space-1) solid var(--border-strong);
      background: var(--surface-raised);
      font-size: var(--fs-sm);
      font-weight: var(--fw-bold);
    }
    .hint[data-tone='warn'] {
      border-left-color: var(--status-warn-solid);
      background: var(--status-warn-bg);
      color: var(--status-warn-fg);
    }
    .hint[data-tone='crit'] {
      border-left-color: var(--status-crit-solid);
      background: var(--status-crit-bg);
      color: var(--status-crit-fg);
    }

    .karte__people {
      display: grid;
      gap: var(--space-3);
    }
    .karte__member {
      display: grid;
      gap: var(--space-1);
    }
    .karte__history {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--space-2);
      margin: 0;
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .karte__reading--pending {
      color: var(--status-warn-fg);
      font-style: italic;
    }
    .karte__retreat {
      margin-left: auto;
      font-weight: var(--fw-bold);
      color: var(--text);
    }
    .karte__retreat--reached {
      color: var(--status-crit-fg);
      font-weight: var(--fw-heavy);
    }

    .karte__actions {
      display: grid;
      gap: var(--touch-gap);
      margin-top: auto;
    }
    .karte__druck {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--touch-gap);
    }

    .karte__secondary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--touch-gap);
      padding-top: var(--space-3);
      border-top: var(--border-w-thin) solid var(--border);
    }
    :host([data-status='beendet']) .karte__secondary {
      margin-top: auto;
    }

    /* Mayday ausloesen: eine Sekunde halten, der Balken zeigt den Fortschritt */
    .mayday-hold {
      position: relative;
      overflow: hidden;
      margin-left: auto;
      min-height: var(--touch-min);
      padding: var(--space-2) var(--space-4);
      border: var(--border-w) solid var(--status-crit-solid);
      border-radius: var(--radius-md);
      background: var(--status-crit-bg);
      color: var(--status-crit-fg);
      font-size: var(--fs-sm);
      font-weight: var(--fw-heavy);
      letter-spacing: var(--tracking-caps);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    .mayday-hold__fill {
      position: absolute;
      inset: 0;
      width: 0;
      background: var(--status-crit-solid);
    }
    .mayday-hold--active .mayday-hold__fill {
      width: 100%;
      transition: width 1s linear;
    }
    .mayday-hold__icon,
    .mayday-hold__label {
      position: relative;
    }
    .mayday-hold--active {
      color: var(--status-crit-on);
    }

    @media (max-width: 520px) {
      :host {
        padding: var(--space-3);
        padding-top: calc(var(--space-3) + var(--space-2));
      }
      .mayday-hold {
        margin-left: 0;
        flex: 1 1 100%;
      }
      .karte__druck button {
        padding-inline: var(--space-2);
        font-size: var(--fs-base);
      }
    }
  `
})
export class TruppKarteComponent implements OnDestroy {
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
  readonly titleId = `trupp-karte-${++nextId}`;

  readonly status = computed(() => displayStatus(this.trupp(), this.now()));
  readonly pressureStage = computed(() => pressureCheckDue(this.trupp(), this.now()));
  readonly zustand = computed<TruppZustand>(() => zustandOf(this.trupp()));
  readonly stateIcon = computed(() => STATE_ICON[this.zustand()]);
  readonly next = computed(() => nextZustand(this.trupp()));
  readonly stateSince = computed(() => this.trupp().zustandSeit ?? this.trupp().startzeit);
  readonly retreat = computed(() => retreatInfo(this.trupp(), this.now()));
  readonly retreatDue = computed(() => Boolean(this.retreat()?.reached || this.retreat()?.estimatedReached));

  readonly seconds = computed(() => {
    const trupp = this.trupp();
    return trupp.endzeit ? elapsedSeconds(trupp, this.now()) : remainingSeconds(trupp, this.now());
  });

  readonly timeTone = computed(() => {
    switch (this.status()) {
      case 'ueberfaellig':
      case 'mayday':
        return 'crit';
      case 'rueckzug':
        return 'warn';
      case 'beendet':
        return 'muted';
      default:
        return 'default';
    }
  });

  // Hinweiszeilen unter der Zeit, dringendste zuerst.
  readonly hints = computed(() => {
    const list: { key: string; tone: 'crit' | 'warn' | 'info'; icon: IconName; params?: Record<string, string | number> }[] = [];
    const retreat = this.retreat();
    if (retreat?.reached) {
      list.push({ key: 'retreat.reached', tone: 'crit', icon: 'alert-circle' });
    } else if (retreat?.estimatedReached) {
      list.push({ key: 'retreat.estimated', tone: 'warn', icon: 'alert-triangle' });
    }
    const stage = this.pressureStage();
    if (stage) {
      list.push({
        key: 'dashboard.pressureCheckDue',
        tone: 'warn',
        icon: 'gauge',
        params: { fraction: pressureCheckFraction(stage) }
      });
    }
    if (retreat?.missing) {
      list.push({ key: 'retreat.missing', tone: 'info', icon: 'info' });
    }
    if (this.trupp().endPending) {
      list.push({ key: 'outbox.endPending', tone: 'info', icon: 'pending' });
    }
    return list;
  });

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
    }, TruppKarteComponent.maydayHoldMs);
  }

  cancelHold(): void {
    window.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.holding.set(false);
  }

  ngOnDestroy(): void {
    this.cancelHold();
  }
}
