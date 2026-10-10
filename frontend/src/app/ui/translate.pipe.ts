import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslationService } from '../translation.service';

// Einzige Ausnahme fuer Presentational Components: Texte uebersetzen. Nicht pure, damit ein Sprachwechsel
// sofort greift (die Sprache ist ein Signal, das Nachschlagen ist billig).
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(TranslationService);

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
