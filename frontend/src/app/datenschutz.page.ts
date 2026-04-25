import { CommonModule } from '@angular/common';
import { Component, effect } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslationService } from './translation.service';

@Component({
  selector: 'app-datenschutz-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './datenschutz.page.html'
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
