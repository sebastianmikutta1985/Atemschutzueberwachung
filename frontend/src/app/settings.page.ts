import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, OnDestroy, OnInit, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { ThemeMode, ThemeStore } from './theme.store';
import { AuditEintrag, Geraetetraeger, OrgSettings, TruppName } from './models';
import { RealtimeService } from './realtime.service';
import { SessionService } from './session.service';
import { TranslationService } from './translation.service';
import { BannerComponent } from './ui/banner.component';
import { ButtonComponent, IconButtonComponent } from './ui/button.component';
import { ConnectionIndicatorComponent, LiveStatus } from './ui/connection-indicator.component';
import { DialogComponent } from './ui/dialog.component';
import { IconComponent } from './ui/icon.component';
import { LangSwitchComponent } from './ui/lang-switch.component';
import { PageComponent } from './ui/page.component';
import { PanelComponent } from './ui/panel.component';
import { TranslatePipe } from './ui/translate.pipe';

// Rueckfrage vor dem Loeschen (statt window.confirm), mit klar benannter Aktion.
interface ConfirmModal {
  title: string;
  text: string;
  action: () => void;
}

@Component({
  selector: 'app-settings-page',
  imports: [
    DatePipe,
    FormsModule,
    BannerComponent,
    ButtonComponent,
    IconButtonComponent,
    ConnectionIndicatorComponent,
    DialogComponent,
    IconComponent,
    LangSwitchComponent,
    PageComponent,
    PanelComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrls: ['./admin-list.css', './settings.page.css']
})
export class SettingsPage implements OnInit, OnDestroy {
  private readonly baseUrl = environment.apiBaseUrl;

  readonly geraetetraeger = signal<Geraetetraeger[]>([]);
  readonly truppnamen = signal<TruppName[]>([]);
  readonly orgSettings = signal<OrgSettings | null>(null);
  readonly auditEntries = signal<AuditEintrag[]>([]);
  readonly dragIndex = signal<number | null>(null);
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  readonly liveStatus = signal<LiveStatus>('disconnected');
  readonly themeMode = signal<ThemeMode>('light');

  geraetetraegerForm = {
    vorname: '',
    nachname: '',
    funkrufname: '',
    aktiv: true
  };

  truppNameForm = {
    name: '',
    aktiv: true
  };

  orgSettingsForm = {
    defaultStartdruckPerson1Bar: 300,
    defaultStartdruckPerson2Bar: 300,
    defaultWarnzeitMin: 25,
    defaultMaxzeitMin: 30,
    defaultRueckzugReserveBar: 10
  };
  readonly orgSettingsMessage = signal('');
  readonly importMessage = signal('');
  importRows: { vorname: string; nachname: string; funkrufname: string; aktiv: boolean }[] = [];
  private lastLiveStatus: LiveStatus = 'disconnected';
  readonly toasts = signal<{ id: number; text: string; type: 'warn' }[]>([]);
  private toastId = 0;

  readonly editingTruppNameId = signal<string | null>(null);
  editingTruppNameValue = '';
  readonly confirmModal = signal<ConfirmModal | null>(null);

  constructor(
    private http: HttpClient,
    private realtime: RealtimeService,
    private session: SessionService,
    private title: Title,
    public i18n: TranslationService
  ) {
    effect(() => {
      this.i18n.lang();
      this.updatePageTitle();
    });
  }

  ngOnInit(): void {
    this.loadTheme();
    this.updatePageTitle();
    this.loadGeraetetraeger();
    this.loadTruppnamen();
    this.loadOrgSettings();
    this.loadAudit();

    this.realtime.start();
    this.unsubscribeRealtime = this.realtime.onUpdate((type) => {
      if (type === 'geraetetraeger') {
        this.loadGeraetetraeger();
      }
      if (type === 'truppnamen') {
        this.loadTruppnamen();
      }
      if (type === 'settings') {
        this.loadOrgSettings();
      }
      if (type === 'einsatz') {
        this.loadAudit();
      }
    });
    this.unsubscribeStatus = this.realtime.onStatus((status) => {
      if (status === 'disconnected' && this.lastLiveStatus !== 'disconnected') {
        this.pushToast(this.i18n.t('dashboard.liveOffline'), 'warn');
      }
      this.lastLiveStatus = status;
      this.liveStatus.set(status);
    });
  }

  private loadTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode.set(ThemeStore.load(themeKey));
    ThemeStore.apply(this.themeMode());
  }

  private updatePageTitle(): void {
    const auth = AuthStore.load();
    const org = auth?.orgName ? ` - ${auth.orgName}` : '';
    this.title.setTitle(`${this.i18n.t('common.appName')}${org}`);
  }

  toggleTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode.set(this.themeMode() === 'dark' ? 'light' : 'dark');
    ThemeStore.save(this.themeMode(), themeKey);
    ThemeStore.apply(this.themeMode());
  }

  ngOnDestroy(): void {
    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
    }
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
    }
  }

  // Fehlermeldung des Backends anzeigen statt still zu scheitern (401 behandelt der Interceptor).
  private showApiError(err: { error?: { error?: string } } | null): void {
    this.pushToast(err?.error?.error ?? this.i18n.t('settings.saveFailed'), 'warn');
  }

  private pushToast(text: string, type: 'warn'): void {
    const id = ++this.toastId;
    this.toasts.update((list) => [...list, { id, text, type }]);
    window.setTimeout(() => {
      this.toasts.update((list) => list.filter((t) => t.id !== id));
    }, 6000);
  }

  get authInfo(): { orgName: string; orgCode: string } | null {
    const auth = AuthStore.load();
    if (!auth) {
      return null;
    }
    return { orgName: auth.orgName, orgCode: auth.orgCode };
  }

  logout(): void {
    this.session.logout();
  }

  confirmAction(): void {
    const action = this.confirmModal()?.action;
    this.confirmModal.set(null);
    action?.();
  }

  loadGeraetetraeger(): void {
    this.http.get<Geraetetraeger[]>(`${this.baseUrl}/geraetetraeger`).subscribe((list) => {
      this.geraetetraeger.set(list);
    });
  }

  loadTruppnamen(): void {
    this.http.get<TruppName[]>(`${this.baseUrl}/truppnamen`).subscribe((list) => {
      this.truppnamen.set(list);
    });
  }

  loadAudit(): void {
    this.http.get<AuditEintrag[]>(`${this.baseUrl}/audit`).subscribe((list) => {
      this.auditEntries.set(list);
    });
  }

  // Details liegen als JSON vor; unbekannte Aktionen werden roh angezeigt.
  describeAudit(entry: AuditEintrag): string {
    if (entry.aktion === 'einsatz_geloescht') {
      try {
        const d = JSON.parse(entry.details) as { einsatz: string; trupps: number; grund: string };
        return this.i18n.t('settings.auditDeleted', { name: d.einsatz, crews: d.trupps, reason: d.grund });
      } catch {
        // fallthrough
      }
    }
    return `${entry.aktion}: ${entry.details}`;
  }

  private applyOrgSettings(settings: OrgSettings): void {
    this.orgSettingsForm.defaultStartdruckPerson1Bar = settings.defaultStartdruckPerson1Bar;
    this.orgSettingsForm.defaultStartdruckPerson2Bar = settings.defaultStartdruckPerson2Bar;
    this.orgSettingsForm.defaultWarnzeitMin = settings.defaultWarnzeitMin;
    this.orgSettingsForm.defaultMaxzeitMin = settings.defaultMaxzeitMin;
    this.orgSettingsForm.defaultRueckzugReserveBar = settings.defaultRueckzugReserveBar;
    // Zuletzt setzen: das Signal stoesst die Anzeige des geaenderten Formulars an.
    this.orgSettings.set(settings);
  }

  loadOrgSettings(): void {
    this.http.get<OrgSettings>(`${this.baseUrl}/settings`).subscribe((settings) => {
      this.applyOrgSettings(settings);
    });
  }

  saveOrgSettings(): void {
    this.orgSettingsMessage.set('');
    const payload = {
      defaultStartdruckPerson1Bar: this.orgSettingsForm.defaultStartdruckPerson1Bar,
      defaultStartdruckPerson2Bar: this.orgSettingsForm.defaultStartdruckPerson2Bar,
      defaultWarnzeitMin: this.orgSettingsForm.defaultWarnzeitMin,
      defaultMaxzeitMin: this.orgSettingsForm.defaultMaxzeitMin,
      defaultRueckzugReserveBar: this.orgSettingsForm.defaultRueckzugReserveBar
    };
    this.http.put<OrgSettings>(`${this.baseUrl}/settings`, payload).subscribe({
      next: (settings) => {
        this.applyOrgSettings(settings);
        this.orgSettingsMessage.set(this.i18n.t('settings.saved'));
      },
      error: (err) => {
        this.orgSettingsMessage.set(err?.error?.error ?? this.i18n.t('settings.saveFailed'));
      }
    });
  }

  addGeraetetraeger(): void {
    const payload = {
      vorname: this.geraetetraegerForm.vorname.trim(),
      nachname: this.geraetetraegerForm.nachname.trim(),
      funkrufname: this.geraetetraegerForm.funkrufname.trim(),
      aktiv: this.geraetetraegerForm.aktiv
    };

    if (!payload.vorname || !payload.nachname) {
      return;
    }

    this.http.post<Geraetetraeger>(`${this.baseUrl}/geraetetraeger`, payload).subscribe({
      next: () => {
        this.geraetetraegerForm.vorname = '';
        this.geraetetraegerForm.nachname = '';
        this.geraetetraegerForm.funkrufname = '';
        this.geraetetraegerForm.aktiv = true;
        this.loadGeraetetraeger();
      },
      error: (err) => this.showApiError(err)
    });
  }

  importGeraetetraeger(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.importMessage.set(this.i18n.t('settings.importRunning'));
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      this.importRows = this.parseCsvRows(text);
      if (this.importRows.length === 0) {
        this.importMessage.set(this.i18n.t('settings.importNoValidRows'));
        return;
      }
      const plan = this.buildImportPlan();
      this.importMessage.set(
        this.i18n.t('settings.csvLoaded', {
          newCount: plan.toCreate.length,
          skipped: plan.skipped
        })
      );
    };
    reader.readAsText(file, 'utf-8');
  }

  downloadCsvBeispiel(): void {
    const sample = [
      'Vorname;Nachname;Funkrufname;Aktiv',
      'Max;Mustermann;Funk 1;true',
      'Anna;Musterfrau;;false'
    ].join('\n');
    const blob = new Blob(['﻿' + sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.i18n.t('settings.carrierImportFile');
    anchor.click();
    URL.revokeObjectURL(url);
  }

  previewCsvImport(): void {
    if (!this.importRows.length) {
      this.importMessage.set(this.i18n.t('settings.selectCsvFirst'));
      return;
    }
    const plan = this.buildImportPlan();
    this.importMessage.set(
      this.i18n.t('settings.importPreview', {
        newCount: plan.toCreate.length,
        skipped: plan.skipped
      })
    );
  }

  runCsvImport(): void {
    if (!this.importRows.length) {
      this.importMessage.set(this.i18n.t('settings.selectCsvFirst'));
      return;
    }
    const plan = this.buildImportPlan();
    if (plan.toCreate.length === 0) {
      this.importMessage.set(this.i18n.t('settings.noNewEntries'));
      return;
    }
    this.importMessage.set(this.i18n.t('settings.importRunning'));
    let done = 0;
    let failed = 0;
    // "complete" wird nach einem Fehler nicht aufgerufen, daher Abschluss in beiden Faellen pruefen.
    const finishIfDone = () => {
      if (done + failed === plan.toCreate.length) {
        this.importMessage.set(this.i18n.t('settings.importFinished', { done, failed }));
        this.importRows = [];
        this.loadGeraetetraeger();
      }
    };
    plan.toCreate.forEach((row) => {
      this.http
        .post<Geraetetraeger>(`${this.baseUrl}/geraetetraeger`, row)
        .subscribe({
          next: () => {
            done += 1;
            finishIfDone();
          },
          error: () => {
            failed += 1;
            finishIfDone();
          }
        });
    });
  }

  private parseCsvRows(text: string): { vorname: string; nachname: string; funkrufname: string; aktiv: boolean }[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return [];
    }
    const rows = lines.map((line) => line.split(';').map((c) => c.trim()));
    const maybeHeader = rows[0].map((c) => c.toLowerCase());
    const hasHeader =
      maybeHeader.includes('vorname') || maybeHeader.includes('nachname') || maybeHeader.includes('funkrufname');
    const dataRows = hasHeader ? rows.slice(1) : rows;

    return dataRows
      .filter((r) => r.length >= 2)
      .map((r) => {
        const vorname = r[0] || '';
        const nachname = r[1] || '';
        const funkrufname = r[2] || '';
        const aktivRaw = (r[3] || 'true').toLowerCase();
        const aktiv = !(aktivRaw === 'false' || aktivRaw === '0' || aktivRaw === 'nein' || aktivRaw === 'inaktiv');
        return { vorname, nachname, funkrufname, aktiv };
      })
      .filter((r) => r.vorname && r.nachname);
  }

  private buildImportPlan(): { toCreate: { vorname: string; nachname: string; funkrufname: string; aktiv: boolean }[]; skipped: number } {
    const normalize = (value: string) => value.trim().toLowerCase();
    const key = (v: { vorname: string; nachname: string; funkrufname: string }) =>
      `${normalize(v.nachname)}|${normalize(v.vorname)}|${normalize(v.funkrufname || '')}`;

    const existingKeys = new Set(
      this.geraetetraeger().map((g) =>
        key({ vorname: g.vorname, nachname: g.nachname, funkrufname: g.funkrufname ?? '' })
      )
    );

    const seen = new Set<string>();
    const toCreate: { vorname: string; nachname: string; funkrufname: string; aktiv: boolean }[] = [];
    let skipped = 0;

    for (const row of this.importRows) {
      const rowKey = key(row);
      if (existingKeys.has(rowKey) || seen.has(rowKey)) {
        skipped += 1;
        continue;
      }
      seen.add(rowKey);
      toCreate.push(row);
    }

    return { toCreate, skipped };
  }

  toggleGeraetetraeger(traeger: Geraetetraeger): void {
    const payload = {
      vorname: traeger.vorname,
      nachname: traeger.nachname,
      funkrufname: traeger.funkrufname ?? '',
      aktiv: !traeger.aktiv
    };

    this.http.put<Geraetetraeger>(`${this.baseUrl}/geraetetraeger/${traeger.id}`, payload).subscribe({
      next: () => {
        this.loadGeraetetraeger();
      },
      error: (err) => this.showApiError(err)
    });
  }

  deleteGeraetetraeger(traeger: Geraetetraeger): void {
    this.confirmModal.set({
      title: this.i18n.t('common.delete'),
      text: this.i18n.t('settings.deleteCarrierConfirm', { name: traeger.nachname }),
      action: () => {
        this.http.delete(`${this.baseUrl}/geraetetraeger/${traeger.id}`).subscribe({
          next: () => {
            this.loadGeraetetraeger();
          },
          error: (err) => this.showApiError(err)
        });
      }
    });
  }

  addTruppName(): void {
    const payload = {
      name: this.truppNameForm.name.trim(),
      aktiv: this.truppNameForm.aktiv
    };

    if (!payload.name) {
      return;
    }

    this.http.post<TruppName>(`${this.baseUrl}/truppnamen`, payload).subscribe({
      next: () => {
        this.truppNameForm.name = '';
        this.truppNameForm.aktiv = true;
        this.loadTruppnamen();
      },
      error: (err) => this.showApiError(err)
    });
  }

  toggleTruppName(item: TruppName): void {
    const payload = {
      name: item.name,
      aktiv: !item.aktiv,
      orderIndex: item.orderIndex
    };

    this.http.put<TruppName>(`${this.baseUrl}/truppnamen/${item.id}`, payload).subscribe({
      next: () => {
        this.loadTruppnamen();
      },
      error: (err) => this.showApiError(err)
    });
  }

  deleteTruppName(item: TruppName): void {
    this.confirmModal.set({
      title: this.i18n.t('common.delete'),
      text: this.i18n.t('settings.deleteCrewConfirm', { name: item.name }),
      action: () => {
        this.http.delete(`${this.baseUrl}/truppnamen/${item.id}`).subscribe({
          next: () => {
            this.loadTruppnamen();
          },
          error: (err) => this.showApiError(err)
        });
      }
    });
  }

  startEditTruppName(item: TruppName): void {
    this.editingTruppNameValue = item.name;
    this.editingTruppNameId.set(item.id);
  }

  cancelEditTruppName(): void {
    this.editingTruppNameId.set(null);
    this.editingTruppNameValue = '';
  }

  saveEditTruppName(item: TruppName): void {
    const payload = {
      name: this.editingTruppNameValue.trim(),
      aktiv: item.aktiv,
      orderIndex: item.orderIndex
    };

    if (!payload.name) {
      return;
    }

    this.http.put<TruppName>(`${this.baseUrl}/truppnamen/${item.id}`, payload).subscribe({
      next: () => {
        this.cancelEditTruppName();
        this.loadTruppnamen();
      },
      error: (err) => this.showApiError(err)
    });
  }

  onDragStart(index: number, event: DragEvent): void {
    this.dragIndex.set(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    const from = this.dragIndex();
    this.dragIndex.set(null);
    if (from === null || from === index) {
      return;
    }
    const updated = [...this.truppnamen()];
    const [item] = updated.splice(from, 1);
    updated.splice(index, 0, item);
    this.truppnamen.set(updated);
    this.saveTruppnamenOrder();
  }

  moveTruppName(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= this.truppnamen().length) {
      return;
    }
    const updated = [...this.truppnamen()];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    this.truppnamen.set(updated);
    this.saveTruppnamenOrder();
  }

  private saveTruppnamenOrder(): void {
    const ids = this.truppnamen().map((t) => t.id);
    this.http.post(`${this.baseUrl}/truppnamen/reorder`, { ids }).subscribe({
      next: () => {
        this.loadTruppnamen();
      },
      error: (err) => this.showApiError(err)
    });
  }
}
