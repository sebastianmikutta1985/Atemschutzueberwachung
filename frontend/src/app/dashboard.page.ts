import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, effect, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { ClockService } from './clock.service';
import { parseEpoch } from './crew-status';
import { ExportService } from './export.service';
import { DruckInfo, Einsatz, Geraetetraeger, OrgSettings, Trupp, TruppName } from './models';
import { MonitoringService } from './monitoring.service';
import { RealtimeService } from './realtime.service';
import { SessionService } from './session.service';
import { ThemeMode, ThemeStore } from './theme.store';
import { TranslationService } from './translation.service';
import { TruppCardComponent } from './trupp-card.component';

// Einsatz- und Trupp-Erfassung. Ueberwachung, Alarme und Ton liegen im MonitoringService,
// die Anzeige einzelner Trupps in TruppCardComponent, Exporte im ExportService.
@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, FormsModule, RouterLink, TruppCardComponent],
  templateUrl: './dashboard.page.html'
})
export class DashboardPage implements OnInit, OnDestroy {
  private readonly baseUrl = environment.apiBaseUrl;
  @ViewChild('druckInput') druckInput?: ElementRef<HTMLInputElement>;
  @ViewChild('dashboardSection') dashboardSection?: ElementRef<HTMLElement>;
  @ViewChild('confirmCancel') confirmCancel?: ElementRef<HTMLButtonElement>;
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  liveStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  themeMode: ThemeMode = 'light';
  mobileMetaOpen = false;

  geraetetraeger: Geraetetraeger[] = [];
  truppnamen: TruppName[] = [];
  letzteEinsaetze: Einsatz[] = [];
  private defaultsApplied = false;

  einsatzForm = {
    name: '',
    ort: '',
    alarmzeit: ''
  };

  truppForm = {
    truppNameId: '',
    person1Id: '',
    person2Id: '',
    startdruckPerson1Bar: 300,
    startdruckPerson2Bar: 300,
    startzeit: '',
    warnzeitMin: 25,
    maxzeitMin: 30
  };

  private lastAutoStartzeit = '';
  private lastAutoAlarmzeit = '';
  errorMessage = '';
  truppError = '';

  druckModal: {
    open: boolean;
    trupp: Trupp;
    personId: string;
    personName: string;
    value: number | null;
    last: DruckInfo[];
  } | null = null;
  druckModalError = '';
  // Verhindert eine doppelte Messung durch erneutes Tippen, waehrend die erste noch uebertragen wird.
  druckSaving = false;

  detailsModal: {
    open: boolean;
    einsatz: Einsatz;
    trupps: Trupp[];
    loading: boolean;
  } | null = null;
  deleteModal: { open: boolean; einsatz: Einsatz } | null = null;
  // Bestaetigung fuer nicht umkehrbare Aktionen (Einsatz/Trupp beenden).
  confirmModal: { title: string; text: string; confirmLabel: string; action: () => void } | null = null;

  constructor(
    private http: HttpClient,
    private realtime: RealtimeService,
    private session: SessionService,
    private clock: ClockService,
    private exporter: ExportService,
    readonly monitoring: MonitoringService,
    private title: Title,
    public i18n: TranslationService
  ) {
    effect(() => {
      this.i18n.lang();
      this.updatePageTitle();
    });
  }

  get currentEinsatz(): Einsatz | null {
    return this.monitoring.einsatz();
  }

  get trupps(): Trupp[] {
    return this.monitoring.trupps();
  }

  get currentEpoch(): number {
    return this.monitoring.now();
  }

  // Karten beim Neuladen wiederverwenden statt neu aufzubauen.
  trackTrupp(_index: number, trupp: Trupp): string {
    return trupp.id;
  }

  ngOnInit(): void {
    this.loadTheme();
    this.updatePageTitle();
    this.setAutoAlarmzeitNow();
    this.setAutoStartzeitNow();
    this.monitoring.start();
    this.monitoring.refresh();
    this.loadGeraetetraeger();
    this.loadTruppnamen();
    this.loadOrgSettings();
    this.loadLetzteEinsaetze();

    this.unsubscribeRealtime = this.realtime.onUpdate((type) => {
      if (type === 'einsatz') {
        this.loadLetzteEinsaetze();
      }
    });
    this.unsubscribeStatus = this.realtime.onStatus((status) => {
      if (status === 'disconnected' && this.liveStatus !== 'disconnected') {
        this.monitoring.notify(this.i18n.t('dashboard.liveOffline'), 'warn');
      }
      this.liveStatus = status;
    });
  }

  ngOnDestroy(): void {
    this.unsubscribeRealtime?.();
    this.unsubscribeStatus?.();
  }

  private updatePageTitle(): void {
    const auth = AuthStore.load();
    const org = auth?.orgName ? ` - ${auth.orgName}` : '';
    this.title.setTitle(`${this.i18n.t('common.appName')}${org}`);
  }

  private loadTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode = ThemeStore.load(themeKey);
    ThemeStore.apply(this.themeMode);
  }

  toggleTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode = this.themeMode === 'dark' ? 'light' : 'dark';
    ThemeStore.save(this.themeMode, themeKey);
    ThemeStore.apply(this.themeMode);
  }

  toggleMobileMeta(): void {
    this.mobileMetaOpen = !this.mobileMetaOpen;
  }

  // Escape schliesst Dialoge – ausser dem Alarm, der ausdruecklich bestaetigt werden muss.
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.monitoring.alarm()) {
      return;
    }
    if (this.confirmModal) {
      this.closeConfirmModal();
    } else if (this.druckModal) {
      this.closeDruckModal();
    } else if (this.detailsModal) {
      this.closeEinsatzDetails();
    } else if (this.deleteModal) {
      this.closeDeleteModal();
    }
  }

  canAddTrupp(): boolean {
    return Boolean(
      this.currentEinsatz &&
        this.truppForm.truppNameId &&
        this.truppForm.person1Id &&
        this.truppForm.person2Id
    );
  }

  personOptionLabel(person: Geraetetraeger): string {
    return `${person.nachname} ${person.vorname}${person.funkrufname ? ' (' + person.funkrufname + ')' : ''}`;
  }

  get availableTruppnamen(): TruppName[] {
    return this.activeTruppnamen.filter((t) => !this.isTruppNameInActiveTrupp(t.id));
  }

  get availablePerson1(): Geraetetraeger[] {
    return this.geraetetraeger.filter(
      (t) =>
        t.aktiv !== false &&
        t.id !== this.truppForm.person2Id &&
        !this.isPersonInActiveTrupp(t.id)
    );
  }

  get availablePerson2(): Geraetetraeger[] {
    return this.geraetetraeger.filter(
      (t) =>
        t.aktiv !== false &&
        t.id !== this.truppForm.person1Id &&
        !this.isPersonInActiveTrupp(t.id)
    );
  }

  get activeTruppnamen(): TruppName[] {
    return this.truppnamen.filter((t) => t.aktiv !== false);
  }

  // Hinweis, wenn die Geraeteuhr um mindestens eine Minute abweicht; die Anzeige ist bereits korrigiert.
  // Negativer Offset = Server liegt zurueck = Geraeteuhr geht vor.
  get clockDeviationText(): string | null {
    const minutes = Math.round(this.clock.offsetMs() / 60000);
    if (Math.abs(minutes) < 1) {
      return null;
    }
    return this.i18n.t(minutes < 0 ? 'dashboard.clockAhead' : 'dashboard.clockBehind', { minutes: Math.abs(minutes) });
  }

  get authInfo(): { orgName: string; orgCode: string; role: string } | null {
    const auth = AuthStore.load();
    if (!auth) {
      return null;
    }
    return { orgName: auth.orgName, orgCode: auth.orgCode, role: auth.role };
  }

  logout(): void {
    const waiting = this.monitoring.outbox.waiting().length;
    if (waiting === 0) {
      this.session.logout();
      return;
    }
    // Nicht uebertragene Eingaben bleiben auf diesem Geraet und werden nach der naechsten Anmeldung gesendet.
    this.confirmModal = {
      title: this.i18n.t('outbox.logoutTitle'),
      text: this.i18n.t('outbox.logoutText', { count: waiting }),
      confirmLabel: this.i18n.t('common.logout'),
      action: () => this.session.logout()
    };
    this.focusSoon(() => this.confirmCancel);
  }

  refresh(): void {
    this.monitoring.refresh();
    this.loadLetzteEinsaetze();
  }

  loadLetzteEinsaetze(): void {
    this.http.get<Einsatz[]>(`${this.baseUrl}/einsaetze/letzte?limit=8`).subscribe((list) => {
      this.letzteEinsaetze = list.filter((e) => e.status !== 'aktiv');
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
      if (!this.defaultsApplied) {
        this.truppForm.startdruckPerson1Bar = settings.defaultStartdruckPerson1Bar;
        this.truppForm.startdruckPerson2Bar = settings.defaultStartdruckPerson2Bar;
        this.truppForm.warnzeitMin = settings.defaultWarnzeitMin;
        this.truppForm.maxzeitMin = settings.defaultMaxzeitMin;
        this.defaultsApplied = true;
      }
    });
  }

  createEinsatz(): void {
    this.errorMessage = '';
    const name = this.einsatzForm.name.trim();
    const ort = this.einsatzForm.ort.trim();
    if (!name || !ort) {
      return;
    }

    const payload = {
      name,
      ort,
      // Unveraenderte Vorbelegung: Server setzt die Zeit, damit eine lange offene Seite keine alte Zeit sendet.
      alarmzeit:
        this.einsatzForm.alarmzeit === this.lastAutoAlarmzeit ? null : this.toUtcIso(this.einsatzForm.alarmzeit)
    };

    this.http.post<Einsatz>(`${this.baseUrl}/einsaetze`, payload).subscribe({
      next: () => {
        this.monitoring.refresh();
        this.loadLetzteEinsaetze();
      },
      error: (err) => {
        this.errorMessage = this.apiError(err, 'dashboard.operationStartError');
      }
    });
  }

  endEinsatz(): void {
    const einsatz = this.currentEinsatz;
    if (!einsatz) {
      return;
    }
    const activeCrews = this.trupps.filter((t) => !t.endzeit).length;
    this.confirmModal = {
      title: this.i18n.t('dashboard.endOperationConfirmTitle'),
      text:
        activeCrews > 0
          ? this.i18n.t('dashboard.endOperationConfirmActiveCrews', { name: einsatz.name, count: activeCrews })
          : this.i18n.t('dashboard.endOperationConfirmText', { name: einsatz.name }),
      confirmLabel: this.i18n.t('dashboard.endOperation'),
      action: () => this.doEndEinsatz(einsatz)
    };
    this.focusSoon(() => this.confirmCancel);
  }

  private doEndEinsatz(einsatz: Einsatz): void {
    this.http.post<Einsatz>(`${this.baseUrl}/einsaetze/${einsatz.id}/beenden`, {}).subscribe({
      next: () => {
        this.monitoring.refresh();
        this.loadLetzteEinsaetze();
      },
      error: (err) => this.monitoring.notify(this.apiError(err, 'dashboard.actionFailed'), 'warn')
    });
  }

  // Liefert die Fehlermeldung des Backends bzw. einen uebersetzten Standardtext (401 behandelt der Interceptor).
  private apiError(err: { error?: { error?: string } } | null, fallbackKey: string): string {
    return err?.error?.error ?? this.i18n.t(fallbackKey);
  }

  // datetime-local liefert Ortszeit ohne Zeitzone; ans Backend geht immer UTC mit "Z".
  private toUtcIso(localValue: string): string | null {
    if (!localValue) {
      return null;
    }
    const date = new Date(localValue);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  deleteEinsatz(einsatz: Einsatz): void {
    this.deleteModal = { open: true, einsatz };
  }

  confirmDeleteEinsatz(): void {
    if (!this.deleteModal) {
      return;
    }
    const einsatz = this.deleteModal.einsatz;
    this.http.delete(`${this.baseUrl}/einsaetze/${einsatz.id}`).subscribe({
      next: () => {
        this.loadLetzteEinsaetze();
        this.monitoring.refresh();
        this.deleteModal = null;
      },
      error: (err) => {
        this.deleteModal = null;
        this.monitoring.notify(this.apiError(err, 'dashboard.actionFailed'), 'warn');
      }
    });
  }

  closeDeleteModal(): void {
    this.deleteModal = null;
  }

  openEinsatzDetails(einsatz: Einsatz): void {
    this.detailsModal = {
      open: true,
      einsatz,
      trupps: [],
      loading: true
    };

    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`)
      .subscribe((list) => {
        if (this.detailsModal && this.detailsModal.einsatz.id === einsatz.id) {
          this.detailsModal.trupps = [...list].sort(
            (a, b) => (parseEpoch(a.startzeit) ?? 0) - (parseEpoch(b.startzeit) ?? 0)
          );
          this.detailsModal.loading = false;
        }
      });
  }

  exportEinsatz(einsatz: Einsatz): void {
    this.exporter.exportXlsx(einsatz);
  }

  exportEinsatzPdf(einsatz: Einsatz): void {
    this.exporter.exportPdf(einsatz);
  }

  closeEinsatzDetails(): void {
    this.detailsModal = null;
  }

  addTrupp(): void {
    const einsatz = this.currentEinsatz;
    if (!einsatz) {
      return;
    }

    // Unveraenderte Vorbelegung: Startzeit setzt der Server, unabhaengig von der Uhr dieses Geraets.
    const autoStartzeit = this.truppForm.startzeit === this.lastAutoStartzeit;

    const payload = {
      truppNameId: this.truppForm.truppNameId,
      person1Id: this.truppForm.person1Id,
      person2Id: this.truppForm.person2Id,
      startdruckPerson1Bar: this.truppForm.startdruckPerson1Bar,
      startdruckPerson2Bar: this.truppForm.startdruckPerson2Bar,
      startzeit: autoStartzeit ? null : this.toUtcIso(this.truppForm.startzeit),
      warnzeitMin: this.truppForm.warnzeitMin,
      maxzeitMin: this.truppForm.maxzeitMin
    };

    if (!payload.truppNameId || !payload.person1Id || !payload.person2Id) {
      return;
    }
    if (this.isPersonInActiveTrupp(payload.person1Id) || this.isPersonInActiveTrupp(payload.person2Id)) {
      return;
    }
    if (this.isTruppNameInActiveTrupp(payload.truppNameId)) {
      return;
    }

    this.truppError = '';
    this.http.post<Trupp>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`, payload).subscribe({
      next: () => {
        this.truppForm.truppNameId = '';
        this.truppForm.person1Id = '';
        this.truppForm.person2Id = '';
        this.setAutoStartzeitNow();
        this.monitoring.loadTrupps();
        this.scrollToDashboard();
      },
      error: (err) => {
        this.truppError = this.apiError(err, 'dashboard.actionFailed');
      }
    });
  }

  private scrollToDashboard(): void {
    this.dashboardSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  endTrupp(trupp: Trupp): void {
    this.confirmModal = {
      title: this.i18n.t('dashboard.endCrewConfirmTitle'),
      text: this.i18n.t('dashboard.endCrewConfirmText', { name: trupp.bezeichnung }),
      confirmLabel: this.i18n.t('dashboard.endCrew'),
      action: () => this.doEndTrupp(trupp)
    };
    this.focusSoon(() => this.confirmCancel);
  }

  // Fokus erst nach dem Rendern des Dialogs setzen.
  private focusSoon(target: () => ElementRef<HTMLElement> | undefined): void {
    window.setTimeout(() => target()?.nativeElement.focus(), 0);
  }

  confirmAction(): void {
    const action = this.confirmModal?.action;
    this.confirmModal = null;
    action?.();
  }

  closeConfirmModal(): void {
    this.confirmModal = null;
  }

  // Ueber die Warteschlange: das Ende gilt sofort (auch offline) mit der Zeit des Tippens.
  private async doEndTrupp(trupp: Trupp): Promise<void> {
    const result = await this.monitoring.outbox.submit({
      id: this.monitoring.outbox.newId(),
      kind: 'end',
      truppId: trupp.id,
      truppName: trupp.bezeichnung,
      zeit: this.monitoring.outbox.nowIso()
    });
    if (result.status === 'rejected') {
      this.monitoring.notify(result.error, 'warn');
    } else if (result.status === 'queued') {
      this.monitoring.notify(this.i18n.t('outbox.savedOffline'), 'warn');
    }
  }

  addDruckmessung(trupp: Trupp, personId: string): void {
    const personName = personId === trupp.person1Id ? trupp.person1Name : trupp.person2Name;
    const last =
      personId === trupp.person1Id ? trupp.druckMessungenPerson1 : trupp.druckMessungenPerson2;
    this.druckModal = {
      open: true,
      trupp,
      personId,
      personName,
      value: null,
      last
    };
    this.druckModalError = '';
    window.setTimeout(() => {
      this.druckInput?.nativeElement.focus();
    }, 0);
  }

  closeDruckModal(): void {
    this.druckModal = null;
    this.druckModalError = '';
  }

  async saveDruckModal(): Promise<void> {
    if (!this.druckModal || this.druckSaving) {
      return;
    }
    const value = Number(this.druckModal.value);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const maxAllowed = this.maxDruckForModal();
    if (maxAllowed !== null && value > maxAllowed) {
      this.druckModalError = this.i18n.t('dashboard.pressureMaxValue', { value: maxAllowed });
      this.monitoring.notify(this.i18n.t('dashboard.pressureTooHigh', { value: maxAllowed }), 'warn');
      return;
    }
    // Ueber die Warteschlange: ohne Netz wird die Messung mit ihrer Erfassungszeit gespeichert und spaeter gesendet.
    const modal = this.druckModal;
    this.druckSaving = true;
    const result = await this.monitoring.outbox.submit({
      id: this.monitoring.outbox.newId(),
      kind: 'druck',
      truppId: modal.trupp.id,
      truppName: modal.trupp.bezeichnung,
      personId: modal.personId,
      personName: modal.personName,
      druckBar: value,
      zeit: this.monitoring.outbox.nowIso()
    });
    this.druckSaving = false;
    if (result.status === 'rejected') {
      // Dialog offen lassen, damit der Wert korrigiert werden kann.
      this.druckModalError = result.error;
      return;
    }
    this.closeDruckModal();
    if (result.status === 'queued') {
      this.monitoring.notify(this.i18n.t('outbox.savedOffline'), 'warn');
    }
  }

  maxDruckForModal(): number | null {
    if (!this.druckModal) {
      return null;
    }
    const last = this.druckModal.last;
    if (last && last.length > 0) {
      return last[0].druckBar;
    }
    return this.druckModal.personId === this.druckModal.trupp.person1Id
      ? this.druckModal.trupp.startdruckPerson1Bar
      : this.druckModal.trupp.startdruckPerson2Bar;
  }

  isPersonInActiveTrupp(personId: string): boolean {
    return this.trupps.some(
      (t) => !t.endzeit && (t.person1Id === personId || t.person2Id === personId)
    );
  }

  isTruppNameInActiveTrupp(truppNameId: string): boolean {
    const truppName = this.truppnamen.find((t) => t.id === truppNameId);
    if (!truppName) {
      return false;
    }
    return this.trupps.some((t) => !t.endzeit && t.bezeichnung === truppName.name);
  }

  private toLocalInputValue(date: Date): string {
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private setAutoStartzeitNow(): void {
    const value = this.toLocalInputValue(new Date(this.clock.now()));
    this.truppForm.startzeit = value;
    this.lastAutoStartzeit = value;
  }

  private setAutoAlarmzeitNow(): void {
    const value = this.toLocalInputValue(new Date(this.clock.now()));
    this.einsatzForm.alarmzeit = value;
    this.lastAutoAlarmzeit = value;
  }
}
