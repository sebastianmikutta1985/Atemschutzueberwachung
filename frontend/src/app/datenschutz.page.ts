import { ChangeDetectionStrategy, Component, effect } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslationService } from './translation.service';
import { LangSwitchComponent } from './ui/lang-switch.component';
import { PageComponent } from './ui/page.component';
import { TranslatePipe } from './ui/translate.pipe';

@Component({
  selector: 'app-datenschutz-page',
  imports: [LangSwitchComponent, PageComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './datenschutz.page.html',
  styleUrl: './legal.page.css'
})
export class DatenschutzPage {
  constructor(
    private title: Title,
    public i18n: TranslationService
  ) {
    effect(() => {
      this.i18n.lang();
      this.title.setTitle(`${this.i18n.t('common.appName')} - ${this.i18n.t('legal.privacy')}`);
    });
  }
}
