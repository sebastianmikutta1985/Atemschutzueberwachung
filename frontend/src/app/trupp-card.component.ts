import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import {
  elapsedSeconds,
  formatMinSec,
  lowestPressure,
  pressureCheckDue,
  pressureCheckFraction,
  remainingSeconds,
  statusFor
} from './crew-status';
import { Trupp } from './models';
import { TranslationService } from './translation.service';

@Component({
  selector: 'app-trupp-card',
  imports: [DatePipe, UpperCasePipe],
  host: { class: 'trupp trupp--stack', '[attr.data-status]': 'status()' },
  template: `
    <div class="trupp__top">
      <div class="trupp__status" [attr.data-status]="status()">{{ statusLabel() | uppercase }}</div>
      <div class="trupp__info">
        <div class="trupp__title">{{ trupp().bezeichnung }}</div>
        <div class="muted">{{ i18n.t('dashboard.p1') }}: {{ trupp().person1Name }}</div>
        <div class="muted">{{ i18n.t('dashboard.p2') }}: {{ trupp().person2Name }}</div>
        @if (trupp().endPending) {
          <div class="pending-note" role="status">{{ i18n.t('outbox.endPending') }}</div>
        }
        @if (pressureStage(); as stage) {
          <div class="pressure-due" role="status">
            {{ i18n.t('dashboard.pressureCheckDue', { fraction: fraction(stage) }) }}
          </div>
        }
      </div>
      <div class="trupp__metrics">
        <div class="trupp__metric">
          <div class="muted">{{ trupp().endzeit ? i18n.t('dashboard.duration') : i18n.t('dashboard.remainingTime') }}</div>
          <div class="metric__value">{{ timeDisplay() }}</div>
        </div>
        <div class="trupp__metric">
          <div class="muted">{{ i18n.t('dashboard.lowestPressure') }}</div>
          <div class="metric__value">{{ lowest() }} bar</div>
        </div>
        <div class="trupp__metric">
          <div class="muted">{{ i18n.t('dashboard.start') }}</div>
          <div class="metric__value">{{ trupp().startzeit | date: 'HH:mm:ss' }}</div>
        </div>
        <div class="trupp__metric">
          <div class="muted">{{ i18n.t('dashboard.startPressureP1Short') }}</div>
          <div class="metric__value">{{ trupp().startdruckPerson1Bar }} bar</div>
          @if (trupp().druckMessungenPerson1.length) {
            <div class="muted">
              {{ i18n.t('dashboard.latestMeasurements') }}
              <div class="druck-list">
                @for (m of trupp().druckMessungenPerson1; track m.zeit) {
                  <div [class.pending]="m.pending">
                    {{ m.druckBar }} bar - {{ m.zeit | date: 'HH:mm:ss' }}@if (m.pending) { · {{ i18n.t('outbox.pendingShort') }}}
                  </div>
                }
              </div>
            </div>
          }
        </div>
        <div class="trupp__metric">
          <div class="muted">{{ i18n.t('dashboard.startPressureP2Short') }}</div>
          <div class="metric__value">{{ trupp().startdruckPerson2Bar }} bar</div>
          @if (trupp().druckMessungenPerson2.length) {
            <div class="muted">
              {{ i18n.t('dashboard.latestMeasurements') }}
              <div class="druck-list">
                @for (m of trupp().druckMessungenPerson2; track m.zeit) {
                  <div [class.pending]="m.pending">
                    {{ m.druckBar }} bar - {{ m.zeit | date: 'HH:mm:ss' }}@if (m.pending) { · {{ i18n.t('outbox.pendingShort') }}}
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </div>
    </div>
    @if (!trupp().endzeit) {
      <div class="trupp__bottom">
        <button
          class="ghost"
          type="button"
          (click)="pressure.emit(trupp().person1Id)"
          [disabled]="trupp().druckCountPerson1 >= 3"
          [class.btn-attention]="(pressureStage() ?? 0) > trupp().druckCountPerson1"
        >
          {{ i18n.t('dashboard.pressureP1Button', { count: trupp().druckCountPerson1 }) }}
        </button>
        <button
          class="ghost"
          type="button"
          (click)="pressure.emit(trupp().person2Id)"
          [disabled]="trupp().druckCountPerson2 >= 3"
          [class.btn-attention]="(pressureStage() ?? 0) > trupp().druckCountPerson2"
        >
          {{ i18n.t('dashboard.pressureP2Button', { count: trupp().druckCountPerson2 }) }}
        </button>
        <button class="primary" type="button" (click)="end.emit()">{{ i18n.t('dashboard.endCrew') }}</button>
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

  readonly status = computed(() => statusFor(this.trupp(), this.now()));
  readonly pressureStage = computed(() => pressureCheckDue(this.trupp(), this.now()));
  readonly lowest = computed(() => lowestPressure(this.trupp()));
  readonly fraction = pressureCheckFraction;

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
