import { CommonModule } from '@angular/common';
import { Component, effect } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslationService } from './translation.service';

@Component({
  selector: 'app-impressum-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './impressum.page.html'
})
export class ImpressumPage {
  constructor(
    private title: Title,
    public i18n: TranslationService
  ) {
    effect(() => {
      this.i18n.lang();
      this.title.setTitle(`${this.i18n.t('common.appName')} - ${this.i18n.t('legal.imprint')}`);
    });
  }
}
