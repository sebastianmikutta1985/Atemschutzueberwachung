import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { ThemeMode, ThemeStore } from './theme.store';
import { Geraetetraeger, OrgSettings, TruppName } from './models';
import { RealtimeService } from './realtime.service';

@Component({
  selector: 'app-settings-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings.page.html'
})
export class SettingsPage implements OnInit, OnDestroy {
  private readonly baseUrl = environment.apiBaseUrl;

  geraetetraeger: Geraetetraeger[] = [];
  truppnamen: TruppName[] = [];
  orgSettings: OrgSettings | null = null;
  dragIndex: number | null = null;
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  liveStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  themeMode: ThemeMode = 'light';

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
    defaultMaxzeitMin: 30
  };
  orgSettingsMessage = '';
  importMessage = '';
  importRows: { vorname: string; nachname: string; funkrufname: string; aktiv: boolean }[] = [];
  private lastLiveStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  toasts: { id: number; text: string; type: 'warn' }[] = [];
  private toastId = 0;

  editingTruppNameId: string | null = null;
  editingTruppNameValue = '';

  constructor(
    private http: HttpClient,
    private router: Router,
    private realtime: RealtimeService,
    private title: Title
  ) {}

  ngOnInit(): void {
    this.loadTheme();
    this.updatePageTitle();
    this.loadGeraetetraeger();
    this.loadTruppnamen();
    this.loadOrgSettings();

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
    });
    this.unsubscribeStatus = this.realtime.onStatus((status) => {
      if (status === 'disconnected' && this.lastLiveStatus !== 'disconnected') {
        this.pushToast('Offline – keine Live-Daten', 'warn');
      }
      this.lastLiveStatus = status;
      this.liveStatus = status;
    });
  }

  private loadTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode = ThemeStore.load(themeKey);
    ThemeStore.apply(this.themeMode);
  }

  private updatePageTitle(): void {
    const auth = AuthStore.load();
    const org = auth?.orgName ? ` - ${auth.orgName}` : '';
    this.title.setTitle(`AirGuard${org}`);
  }

  toggleTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode = this.themeMode === 'dark' ? 'light' : 'dark';
    ThemeStore.save(this.themeMode, themeKey);
    ThemeStore.apply(this.themeMode);
  }

  ngOnDestroy(): void {
    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
    }
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
    }
  }

  private pushToast(text: string, type: 'warn'): void {
    const id = ++this.toastId;
    this.toasts = [...this.toasts, { id, text, type }];
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
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
    this.http.post(`${this.baseUrl}/auth/logout`, {}).subscribe({
      complete: () => {
        AuthStore.clear();
        this.realtime.stop();
        this.router.navigateByUrl('/login');
      }
    });
  }

  loadGeraetetraeger(): void {
    this.http.get<Geraetetraeger[]>(`${this.baseUrl}/geraetetraeger`).subscribe((list) => {
      this.geraetetraeger = list;
    });
  }

  loadTruppnamen(): void {
    this.http.get<TruppName[]>(`${this.baseUrl}/truppnamen`).subscribe((list) => {
      this.truppnamen = list;
    });
  }

  loadOrgSettings(): void {
    this.http.get<OrgSettings>(`${this.baseUrl}/settings`).subscribe((settings) => {
      this.orgSettings = settings;
      this.orgSettingsForm.defaultStartdruckPerson1Bar = settings.defaultStartdruckPerson1Bar;
      this.orgSettingsForm.defaultStartdruckPerson2Bar = settings.defaultStartdruckPerson2Bar;
      this.orgSettingsForm.defaultWarnzeitMin = settings.defaultWarnzeitMin;
      this.orgSettingsForm.defaultMaxzeitMin = settings.defaultMaxzeitMin;
    });
  }

  saveOrgSettings(): void {
    this.orgSettingsMessage = '';
    const payload = {
      defaultStartdruckPerson1Bar: this.orgSettingsForm.defaultStartdruckPerson1Bar,
      defaultStartdruckPerson2Bar: this.orgSettingsForm.defaultStartdruckPerson2Bar,
      defaultWarnzeitMin: this.orgSettingsForm.defaultWarnzeitMin,
      defaultMaxzeitMin: this.orgSettingsForm.defaultMaxzeitMin
    };
    this.http.put<OrgSettings>(`${this.baseUrl}/settings`, payload).subscribe({
      next: (settings) => {
        this.orgSettings = settings;
        this.orgSettingsForm.defaultStartdruckPerson1Bar = settings.defaultStartdruckPerson1Bar;
        this.orgSettingsForm.defaultStartdruckPerson2Bar = settings.defaultStartdruckPerson2Bar;
        this.orgSettingsForm.defaultWarnzeitMin = settings.defaultWarnzeitMin;
        this.orgSettingsForm.defaultMaxzeitMin = settings.defaultMaxzeitMin;
        this.orgSettingsMessage = 'Gespeichert.';
      },
      error: () => {
        this.orgSettingsMessage = 'Speichern fehlgeschlagen.';
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

    this.http.post<Geraetetraeger>(`${this.baseUrl}/geraetetraeger`, payload).subscribe(() => {
      this.geraetetraegerForm.vorname = '';
      this.geraetetraegerForm.nachname = '';
      this.geraetetraegerForm.funkrufname = '';
      this.geraetetraegerForm.aktiv = true;
      this.loadGeraetetraeger();
    });
  }

  importGeraetetraeger(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.importMessage = 'Import läuft...';
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      this.importRows = this.parseCsvRows(text);
      if (this.importRows.length === 0) {
        this.importMessage = 'Keine gültigen Zeilen gefunden.';
        return;
      }
      const plan = this.buildImportPlan();
      this.importMessage = `CSV geladen. Neu: ${plan.toCreate.length}, Übersprungen: ${plan.skipped}.`;
    };
    reader.readAsText(file, 'utf-8');
  }

  downloadCsvBeispiel(): void {
    const sample = [
      'Vorname;Nachname;Funkrufname;Aktiv',
      'Max;Mustermann;Funk 1;true',
      'Anna;Musterfrau;;false'
    ].join('\n');
    const blob = new Blob(['\uFEFF' + sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'geraetetraeger_import.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  previewCsvImport(): void {
    if (!this.importRows.length) {
      this.importMessage = 'Bitte zuerst eine CSV auswählen.';
      return;
    }
    const plan = this.buildImportPlan();
    this.importMessage = `Vorschau: ${plan.toCreate.length} neu, ${plan.skipped} übersprungen.`;
  }

  runCsvImport(): void {
    if (!this.importRows.length) {
      this.importMessage = 'Bitte zuerst eine CSV auswählen.';
      return;
    }
    const plan = this.buildImportPlan();
    if (plan.toCreate.length === 0) {
      this.importMessage = 'Keine neuen Einträge zum Import.';
      return;
    }
    this.importMessage = 'Import läuft...';
    let done = 0;
    let failed = 0;
    plan.toCreate.forEach((row) => {
      this.http
        .post<Geraetetraeger>(`${this.baseUrl}/geraetetraeger`, row)
        .subscribe({
          next: () => {
            done += 1;
          },
          error: () => {
            failed += 1;
          },
          complete: () => {
            if (done + failed === plan.toCreate.length) {
              this.importMessage = `Import fertig. Erfolgreich: ${done}, Fehler: ${failed}.`;
              this.importRows = [];
              this.loadGeraetetraeger();
            }
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
      this.geraetetraeger.map((g) =>
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

    this.http.put<Geraetetraeger>(`${this.baseUrl}/geraetetraeger/${traeger.id}`, payload).subscribe(() => {
      this.loadGeraetetraeger();
    });
  }

  deleteGeraetetraeger(traeger: Geraetetraeger): void {
    const ok = window.confirm(`Geraetetraeger "${traeger.nachname}" wirklich loeschen?`);
    if (!ok) {
      return;
    }

    this.http.delete(`${this.baseUrl}/geraetetraeger/${traeger.id}`).subscribe(() => {
      this.loadGeraetetraeger();
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

    this.http.post<TruppName>(`${this.baseUrl}/truppnamen`, payload).subscribe(() => {
      this.truppNameForm.name = '';
      this.truppNameForm.aktiv = true;
      this.loadTruppnamen();
    });
  }

  toggleTruppName(item: TruppName): void {
    const payload = {
      name: item.name,
      aktiv: !item.aktiv,
      orderIndex: item.orderIndex
    };

    this.http.put<TruppName>(`${this.baseUrl}/truppnamen/${item.id}`, payload).subscribe(() => {
      this.loadTruppnamen();
    });
  }

  deleteTruppName(item: TruppName): void {
    const ok = window.confirm(`Trupp "${item.name}" wirklich loeschen?`);
    if (!ok) {
      return;
    }

    this.http.delete(`${this.baseUrl}/truppnamen/${item.id}`).subscribe(() => {
      this.loadTruppnamen();
    });
  }

  startEditTruppName(item: TruppName): void {
    this.editingTruppNameId = item.id;
    this.editingTruppNameValue = item.name;
  }

  cancelEditTruppName(): void {
    this.editingTruppNameId = null;
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

    this.http.put<TruppName>(`${this.baseUrl}/truppnamen/${item.id}`, payload).subscribe(() => {
      this.cancelEditTruppName();
      this.loadTruppnamen();
    });
  }

  onDragStart(index: number, event: DragEvent): void {
    this.dragIndex = index;
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
    const from = this.dragIndex;
    this.dragIndex = null;
    if (from === null || from === index) {
      return;
    }
    const updated = [...this.truppnamen];
    const [item] = updated.splice(from, 1);
    updated.splice(index, 0, item);
    this.truppnamen = updated;
    this.saveTruppnamenOrder();
  }

  moveTruppName(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= this.truppnamen.length) {
      return;
    }
    const updated = [...this.truppnamen];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    this.truppnamen = updated;
    this.saveTruppnamenOrder();
  }

  private saveTruppnamenOrder(): void {
    const ids = this.truppnamen.map((t) => t.id);
    this.http.post(`${this.baseUrl}/truppnamen/reorder`, { ids }).subscribe(() => {
      this.loadTruppnamen();
    });
  }
}
