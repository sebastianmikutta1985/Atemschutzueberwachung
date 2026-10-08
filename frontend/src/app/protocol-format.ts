import { ProtokollEintrag } from './models';
import { TranslationService } from './translation.service';

// Lesbarer Text eines Protokolleintrags – gemeinsam fuer Protokoll-Dialog, Excel- und PDF-Export.
export function describeProtokollEintrag(e: ProtokollEintrag, i18n: TranslationService): string {
  let text: string;
  switch (e.typ) {
    case 'angelegt':
      text = i18n.t('protocol.created', { details: e.nachricht ?? '' });
      break;
    case 'zustand':
      text = i18n.t(`crewState.step_${e.zustand ?? 'arbeit'}`);
      if (e.druckNichtGemeldet) {
        text += ` – ${i18n.t('protocol.pressureNotReported')}`;
      }
      break;
    case 'druck':
      text = i18n.t(e.anlass === 'ziel' ? 'protocol.pressureAtTarget' : 'protocol.pressure', {
        person: e.person ?? '',
        value: e.druckBar ?? 0
      });
      break;
    case 'warn':
    case 'max':
    case 'warn_ack':
    case 'max_ack':
      text = i18n.t(`protocol.${e.typ}`);
      break;
    case 'beendet':
      text = i18n.t('crewState.step_beendet');
      break;
    case 'mayday':
    case 'mayday_info':
    case 'mayday_ende':
      text = i18n.t(`protocol.${e.typ}`);
      if (e.position) {
        text += ` – ${i18n.t('mayday.position')}: ${e.position}`;
      }
      if (e.druckBar !== null && e.druckBar !== undefined) {
        text += ` – ${i18n.t('mayday.pressure')}: ${e.druckBar} bar`;
      }
      if (e.zeitKorrigiert) {
        text += ` (${i18n.t('protocol.timeCorrected')})`;
      }
      break;
    default:
      text = e.typ;
  }
  if (e.nachricht && e.typ !== 'angelegt') {
    text += ` – ${e.nachricht}`;
  }
  if (e.nachgetragen) {
    text += ` (${i18n.t('protocol.lateEntry')})`;
  }
  return text;
}
