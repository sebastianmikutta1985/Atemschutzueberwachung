import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  signal,
  ViewChild
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { ClockService } from './clock.service';
import { DEFAULT_RESERVE_BAR, parseEpoch } from './crew-status';
import { ExportService } from './export.service';
import { DruckInfo, Einsatz, Geraetetraeger, OrgSettings, ProtokollEintrag, Trupp, TruppName, TruppProtokoll } from './models';
import { describeProtokollEintrag } from './protocol-format';
import { MonitoringService } from './monitoring.service';
import { RealtimeService } from './realtime.service';
import { SessionService } from './session.service';
import { ThemeMode, ThemeStore } from './theme.store';
import { TranslationService } from './translation.service';
import { TruppKarteComponent } from './crew/trupp-karte.component';
import { ButtonComponent, IconButtonComponent } from './ui/button.component';
import { ConnectionIndicatorComponent, LiveStatus } from './ui/connection-indicator.component';
import { DialogComponent } from './ui/dialog.component';
import { IconComponent } from './ui/icon.component';
import { TranslatePipe } from './ui/translate.pipe';

interface DruckModal {
  trupp: Trupp;
  personId: string;
  personName: string;
  value: number | null;
  last: DruckInfo[];
}

interface DetailsModal {
  einsatz: Einsatz;
  trupps: Trupp[];
  loading: boolean;
}

interface DeleteModal {
  einsatz: Einsatz;
  grund: string;
  error: string;
}

// "Ziel erreicht": Druck beider Geraetetraeger als Grundlage der Rueckzugsberechnung (ueberspringbar).
interface ZielModal {
  trupp: Trupp;
  p1: number | null;
  p2: number | null;
  error: string;
}

interface ProtokollModal {
  title: string;
  loading: boolean;
  error: string;
  eintraege: ProtokollEintrag[];
  pendingCount: number;
}

// Bestaetigung fuer nicht umkehrbare Aktionen (Einsatz/Trupp beenden, Rueckweg, Abmelden mit offenen Eingaben).
interface ConfirmModal {
  title: string;
  text: string;
  confirmLabel: string;
  action: () => void;
}

// Einsatz- und Trupp-Erfassung. Ueberwachung, Alarme und Ton liegen im MonitoringService,
// die Anzeige einzelner Trupps in TruppKarteComponent, Exporte im ExportService.
// UI-Zustand liegt in Signals (OnPush); Formularobjekte bleiben veraenderlich fuer ngModel.
@Component({
  selector: 'app-dashboard-page',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    TruppKarteComponent,
    ButtonComponent,
    IconButtonComponent,
    ConnectionIndicatorComponent,
    DialogComponent,
    IconComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.css'
})
export class DashboardPage implements OnInit, OnDestroy {
  private readonly baseUrl = environment.apiBaseUrl;
  @ViewChild('druckInput') druckInput?: ElementRef<HTMLInputElement>;
  // read: ElementRef, weil auf dem Button die ButtonComponent sitzt.
  @ViewChild('confirmCancel', { read: ElementRef }) confirmCancel?: ElementRef<HTMLButtonElement>;
  @ViewChild('zielInput') zielInput?: ElementRef<HTMLInputElement>;
  @ViewChild('deleteReason') deleteReason?: ElementRef<HTMLTextAreaElement>;
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  readonly liveStatus = signal<LiveStatus>('disconnected');
  readonly themeMode = signal<ThemeMode>('light');
  readonly menuOpen = signal(false);
  readonly truppDialogOpen = signal(false);

  readonly geraetetraeger = signal<Geraetetraeger[]>([]);
  readonly truppnamen = signal<TruppName[]>([]);
  readonly letzteEinsaetze = signal<Einsatz[]>([]);
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
  readonly errorMessage = signal('');
  readonly truppError = signal('');

  readonly druckModal = signal<DruckModal | null>(null);
  readonly druckModalError = signal('');
  // Verhindert eine doppelte Messung durch erneutes Tippen, waehrend die erste noch uebertragen wird.
  readonly druckSaving = signal(false);

  readonly detailsModal = signal<DetailsModal | null>(null);
  readonly deleteModal = signal<DeleteModal | null>(null);
  readonly zielModal = signal<ZielModal | null>(null);
  readonly zielSaving = signal(false);
  readonly protokollModal = signal<ProtokollModal | null>(null);
  readonly confirmModal = signal<ConfirmModal | null>(null);

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

  get activeCrewCount(): number {
    return this.trupps.filter((t) => !t.endzeit).length;
  }

  get endedCrewCount(): number {
    return this.trupps.length - this.activeCrewCount;
  }

  get currentEpoch(): number {
    return this.monitoring.now();
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
      if (status === 'disconnected' && this.liveStatus() !== 'disconnected') {
        this.monitoring.notify(this.i18n.t('dashboard.liveOffline'), 'warn');
      }
      this.liveStatus.set(status);
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
    this.themeMode.set(ThemeStore.load(themeKey));
    ThemeStore.apply(this.themeMode());
  }

  toggleTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode.set(this.themeMode() === 'dark' ? 'light' : 'dark');
    ThemeStore.save(this.themeMode(), themeKey);
    ThemeStore.apply(this.themeMode());
  }

  openTruppDialog(): void {
    // Unveraenderte Vorbelegung mitziehen, damit nach laengerer Zeit nicht eine alte Startzeit im Feld steht.
    if (this.truppForm.startzeit === this.lastAutoStartzeit) {
      this.setAutoStartzeitNow();
    }
    this.truppError.set('');
    this.truppDialogOpen.set(true);
  }

  closeTruppDialog(): void {
    this.truppDialogOpen.set(false);
  }

  // Escape schliesst das Menue und Dialoge – ausser dem Alarm, der ausdruecklich bestaetigt werden muss.
  // (Hat ein Dialog den Fokus, schliesst er sich selbst ueber das Dialog-Geruest.)
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.monitoring.alarm()) {
      return;
    }
    if (this.menuOpen()) {
      this.menuOpen.set(false);
    } else if (this.confirmModal()) {
      this.closeConfirmModal();
    } else if (this.protokollModal()) {
      this.closeProtokoll();
    } else if (this.zielModal()) {
      this.closeZielModal();
    } else if (this.druckModal()) {
      this.closeDruckModal();
    } else if (this.detailsModal()) {
      this.closeEinsatzDetails();
    } else if (this.deleteModal()) {
      this.closeDeleteModal();
    } else if (this.truppDialogOpen()) {
      this.closeTruppDialog();
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
    return this.geraetetraeger().filter(
      (t) =>
        t.aktiv !== false &&
        t.id !== this.truppForm.person2Id &&
        !this.isPersonInActiveTrupp(t.id)
    );
  }

  get availablePerson2(): Geraetetraeger[] {
    return this.geraetetraeger().filter(
      (t) =>
        t.aktiv !== false &&
        t.id !== this.truppForm.person1Id &&
        !this.isPersonInActiveTrupp(t.id)
    );
  }

  get activeTruppnamen(): TruppName[] {
    return this.truppnamen().filter((t) => t.aktiv !== false);
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
    this.confirmModal.set({
      title: this.i18n.t('outbox.logoutTitle'),
      text: this.i18n.t('outbox.logoutText', { count: waiting }),
      confirmLabel: this.i18n.t('common.logout'),
      action: () => this.session.logout()
    });
    this.focusSoon(() => this.confirmCancel);
  }

  refresh(): void {
    this.monitoring.refresh();
    this.loadLetzteEinsaetze();
  }

  loadLetzteEinsaetze(): void {
    this.http.get<Einsatz[]>(`${this.baseUrl}/einsaetze/letzte?limit=8`).subscribe((list) => {
      this.letzteEinsaetze.set(list.filter((e) => e.status !== 'aktiv'));
    });
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
    this.errorMessage.set('');
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
        this.errorMessage.set(this.apiError(err, 'dashboard.operationStartError'));
      }
    });
  }

  endEinsatz(): void {
    const einsatz = this.currentEinsatz;
    if (!einsatz) {
      return;
    }
    const activeCrews = this.trupps.filter((t) => !t.endzeit).length;
    const openMaydays = this.monitoring.maydays().length;
    this.confirmModal.set({
      title: this.i18n.t('dashboard.endOperationConfirmTitle'),
      text: openMaydays > 0
        ? this.i18n.t('mayday.endOperationConfirm', { name: einsatz.name, count: openMaydays })
        : activeCrews > 0
          ? this.i18n.t('dashboard.endOperationConfirmActiveCrews', { name: einsatz.name, count: activeCrews })
          : this.i18n.t('dashboard.endOperationConfirmText', { name: einsatz.name }),
      confirmLabel: this.i18n.t('dashboard.endOperation'),
      action: () => this.doEndEinsatz(einsatz)
    });
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
    this.deleteModal.set({ einsatz, grund: '', error: '' });
    this.focusSoon(() => this.deleteReason);
  }

  // Loeschen entfernt das Einsatzprotokoll: nur mit Begruendung, die im Audit-Log festgehalten wird.
  confirmDeleteEinsatz(): void {
    const modal = this.deleteModal();
    if (!modal) {
      return;
    }
    const grund = modal.grund.trim();
    if (grund.length < 5) {
      this.deleteModal.set({ ...modal, error: this.i18n.t('dashboard.deleteReasonTooShort') });
      return;
    }
    this.http.post(`${this.baseUrl}/einsaetze/${modal.einsatz.id}/loeschen`, { grund }).subscribe({
      next: () => {
        this.loadLetzteEinsaetze();
        this.monitoring.refresh();
        this.deleteModal.set(null);
      },
      error: (err) => {
        const current = this.deleteModal();
        if (current) {
          this.deleteModal.set({ ...current, error: this.apiError(err, 'dashboard.actionFailed') });
        }
      }
    });
  }

  closeDeleteModal(): void {
    this.deleteModal.set(null);
  }

  openEinsatzDetails(einsatz: Einsatz): void {
    this.detailsModal.set({ einsatz, trupps: [], loading: true });

    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`)
      .subscribe((list) => {
        const current = this.detailsModal();
        if (current && current.einsatz.id === einsatz.id) {
          this.detailsModal.set({
            ...current,
            trupps: [...list].sort((a, b) => (parseEpoch(a.startzeit) ?? 0) - (parseEpoch(b.startzeit) ?? 0)),
            loading: false
          });
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
    this.detailsModal.set(null);
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

    this.truppError.set('');
    this.http.post<Trupp>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`, payload).subscribe({
      next: () => {
        this.truppForm.truppNameId = '';
        this.truppForm.person1Id = '';
        this.truppForm.person2Id = '';
        this.setAutoStartzeitNow();
        this.monitoring.loadTrupps();
        this.truppDialogOpen.set(false);
      },
      error: (err) => {
        this.truppError.set(this.apiError(err, 'dashboard.actionFailed'));
      }
    });
  }

  endTrupp(trupp: Trupp): void {
    this.confirmModal.set({
      title: this.i18n.t('dashboard.endCrewConfirmTitle'),
      // Offener Mayday: ausdruecklich darauf hinweisen; er bleibt offen, bis "Mayday beendet" erfasst ist.
      text: trupp.maydayAktiv
        ? this.i18n.t('mayday.endCrewConfirm', { name: trupp.bezeichnung })
        : this.i18n.t('dashboard.endCrewConfirmText', { name: trupp.bezeichnung }),
      confirmLabel: this.i18n.t('crewState.step_beendet'),
      action: () => this.doEndTrupp(trupp)
    });
    this.focusSoon(() => this.confirmCancel);
  }

  // Fokus erst nach dem Rendern des Dialogs setzen.
  private focusSoon(target: () => ElementRef<HTMLElement> | undefined): void {
    window.setTimeout(() => target()?.nativeElement.focus(), 0);
  }

  confirmAction(): void {
    const action = this.confirmModal()?.action;
    this.confirmModal.set(null);
    action?.();
  }

  closeConfirmModal(): void {
    this.confirmModal.set(null);
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

  changeZustand(trupp: Trupp, zustand: 'arbeit' | 'rueckweg'): void {
    if (zustand === 'arbeit') {
      this.zielModal.set({ trupp, p1: null, p2: null, error: '' });
      this.focusSoon(() => this.zielInput);
      return;
    }
    // Zustaende lassen sich nicht zuruecknehmen: kurz bestaetigen.
    this.confirmModal.set({
      title: this.i18n.t('crewState.retreatConfirmTitle'),
      text: this.i18n.t('crewState.retreatConfirmText', { name: trupp.bezeichnung }),
      confirmLabel: this.i18n.t('crewState.step_rueckweg'),
      action: () => void this.submitZustand(trupp, 'rueckweg')
    });
    this.focusSoon(() => this.confirmCancel);
  }

  closeZielModal(): void {
    this.zielModal.set(null);
  }

  // Hoechster zulaessiger Wert: letzte Messung bzw. Startdruck der Person.
  maxDruckFor(trupp: Trupp, personId: string): number {
    const last = personId === trupp.person1Id ? trupp.druckMessungenPerson1 : trupp.druckMessungenPerson2;
    if (last.length) {
      return last[0].druckBar;
    }
    return personId === trupp.person1Id ? trupp.startdruckPerson1Bar : trupp.startdruckPerson2Bar;
  }

  // Vorschau im Dialog "Ziel erreicht": Rueckzugsdruck fuer den eingetippten Wert.
  zielRetreat(trupp: Trupp, startBar: number, value: number | null): number | null {
    const bar = Number(value);
    if (!value || !Number.isFinite(bar) || bar <= 0 || bar > startBar) {
      return null;
    }
    return 2 * (startBar - bar) + (trupp.rueckzugReserveBar ?? DEFAULT_RESERVE_BAR);
  }

  private setZielError(error: string): void {
    const modal = this.zielModal();
    if (modal) {
      this.zielModal.set({ ...modal, error });
    }
  }

  async saveZiel(druckNichtGemeldet: boolean): Promise<void> {
    const modal = this.zielModal();
    if (!modal || this.zielSaving()) {
      return;
    }
    const trupp = modal.trupp;
    let zielDruck: { id: string; personId: string; personName: string; druckBar: number }[] = [];
    if (!druckNichtGemeldet) {
      const values = [
        { personId: trupp.person1Id, personName: trupp.person1Name, value: Number(modal.p1) },
        { personId: trupp.person2Id, personName: trupp.person2Name, value: Number(modal.p2) }
      ];
      if (values.some((v) => !modal.p1 || !modal.p2 || !Number.isFinite(v.value) || v.value <= 0)) {
        this.setZielError(this.i18n.t('crewState.targetPressureMissing'));
        return;
      }
      const tooHigh = values.find((v) => v.value > this.maxDruckFor(trupp, v.personId));
      if (tooHigh) {
        this.setZielError(
          this.i18n.t('crewState.targetPressureTooHigh', {
            person: tooHigh.personName,
            value: this.maxDruckFor(trupp, tooHigh.personId)
          })
        );
        return;
      }
      zielDruck = values.map((v) => ({
        id: this.monitoring.outbox.newId(),
        personId: v.personId,
        personName: v.personName,
        druckBar: v.value
      }));
    }
    this.zielSaving.set(true);
    const error = await this.submitZustand(trupp, 'arbeit', zielDruck, druckNichtGemeldet);
    this.zielSaving.set(false);
    if (error) {
      // Dialog offen lassen, damit die Werte korrigiert werden koennen.
      this.setZielError(error);
      return;
    }
    this.zielModal.set(null);
  }

  // Ueber die Warteschlange: der Zustand gilt sofort (auch offline) mit der Zeit des Tippens.
  // Liefert die Ablehnung des Servers, falls er die Eingabe direkt zurueckweist.
  private async submitZustand(
    trupp: Trupp,
    zustand: 'arbeit' | 'rueckweg',
    zielDruck: { id: string; personId: string; personName: string; druckBar: number }[] = [],
    druckNichtGemeldet = false
  ): Promise<string | null> {
    const result = await this.monitoring.outbox.submit({
      id: this.monitoring.outbox.newId(),
      kind: 'zustand',
      truppId: trupp.id,
      truppName: trupp.bezeichnung,
      zustand,
      zielDruck,
      druckNichtGemeldet,
      zeit: this.monitoring.outbox.nowIso()
    });
    if (result.status === 'rejected') {
      if (zustand === 'rueckweg') {
        this.monitoring.notify(result.error, 'warn');
      }
      return result.error;
    }
    if (result.status === 'queued') {
      this.monitoring.notify(this.i18n.t('outbox.savedOffline'), 'warn');
    }
    return null;
  }

  openProtokoll(trupp: Trupp): void {
    // Eingaben dieses Geraets, die noch nicht beim Server sind, fehlen im Serverprotokoll: darauf hinweisen.
    const pendingCount = this.monitoring.outbox.waiting().filter((i) => i.truppId === trupp.id).length;
    const modal: ProtokollModal = {
      title: this.i18n.t('protocol.title', { name: trupp.bezeichnung }),
      loading: true,
      error: '',
      eintraege: [],
      pendingCount
    };
    this.protokollModal.set(modal);
    // Nur uebernehmen, solange noch derselbe Dialog offen ist.
    const update = (patch: Partial<ProtokollModal>) => {
      if (this.protokollModal()?.title === modal.title) {
        this.protokollModal.update((m) => (m ? { ...m, ...patch } : m));
      }
    };
    this.http.get<TruppProtokoll>(`${this.baseUrl}/trupps/${trupp.id}/protokoll`).subscribe({
      next: (p) => update({ eintraege: p.eintraege, loading: false }),
      error: (err) => update({ error: this.apiError(err, 'protocol.loadFailed'), loading: false })
    });
  }

  closeProtokoll(): void {
    this.protokollModal.set(null);
  }

  describeEintrag(e: ProtokollEintrag): string {
    return describeProtokollEintrag(e, this.i18n);
  }

  addDruckmessung(trupp: Trupp, personId: string): void {
    const personName = personId === trupp.person1Id ? trupp.person1Name : trupp.person2Name;
    const last =
      personId === trupp.person1Id ? trupp.druckMessungenPerson1 : trupp.druckMessungenPerson2;
    this.druckModal.set({ trupp, personId, personName, value: null, last });
    this.druckModalError.set('');
    window.setTimeout(() => {
      this.druckInput?.nativeElement.focus();
    }, 0);
  }

  closeDruckModal(): void {
    this.druckModal.set(null);
    this.druckModalError.set('');
  }

  async saveDruckModal(): Promise<void> {
    const modal = this.druckModal();
    if (!modal || this.druckSaving()) {
      return;
    }
    const value = Number(modal.value);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const maxAllowed = this.maxDruckForModal();
    if (maxAllowed !== null && value > maxAllowed) {
      this.druckModalError.set(this.i18n.t('dashboard.pressureMaxValue', { value: maxAllowed }));
      this.monitoring.notify(this.i18n.t('dashboard.pressureTooHigh', { value: maxAllowed }), 'warn');
      return;
    }
    // Ueber die Warteschlange: ohne Netz wird die Messung mit ihrer Erfassungszeit gespeichert und spaeter gesendet.
    this.druckSaving.set(true);
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
    this.druckSaving.set(false);
    if (result.status === 'rejected') {
      // Dialog offen lassen, damit der Wert korrigiert werden kann.
      this.druckModalError.set(result.error);
      return;
    }
    this.closeDruckModal();
    if (result.status === 'queued') {
      this.monitoring.notify(this.i18n.t('outbox.savedOffline'), 'warn');
    }
  }

  maxDruckForModal(): number | null {
    const modal = this.druckModal();
    if (!modal) {
      return null;
    }
    if (modal.last && modal.last.length > 0) {
      return modal.last[0].druckBar;
    }
    return modal.personId === modal.trupp.person1Id ? modal.trupp.startdruckPerson1Bar : modal.trupp.startdruckPerson2Bar;
  }

  isPersonInActiveTrupp(personId: string): boolean {
    return this.trupps.some(
      (t) => !t.endzeit && (t.person1Id === personId || t.person2Id === personId)
    );
  }

  isTruppNameInActiveTrupp(truppNameId: string): boolean {
    const truppName = this.truppnamen().find((t) => t.id === truppNameId);
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
