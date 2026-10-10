import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Lang } from '../translation.service';
import { ButtonComponent } from './button.component';
import { IconComponent } from './icon.component';
import { TranslatePipe } from './translate.pipe';

// Sprachwahl DE/EN. Die aktive Sprache ist zusaetzlich zur Farbe ueber aria-pressed erkennbar.
@Component({
  selector: 'app-lang-switch',
  imports: [ButtonComponent, IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lang" role="group" [attr.aria-label]="'language.switchLabel' | t">
    <app-icon name="globe" size="sm" />
    @for (l of langs; track l) {
      <button
        appButton
        size="sm"
        type="button"
        [variant]="lang() === l ? 'primary' : 'ghost'"
        [attr.aria-pressed]="lang() === l"
        (click)="langChange.emit(l)"
      >
        {{ l.toUpperCase() }}
      </button>
    }
    </div>
  `,
  styles: `
    .lang {
      display: inline-flex;
      align-items: center;
      gap: var(--touch-gap);
      color: var(--text-muted);
    }
  `
})
export class LangSwitchComponent {
  readonly lang = input.required<Lang>();
  readonly langChange = output<Lang>();
  readonly langs: Lang[] = ['de', 'en'];
}
