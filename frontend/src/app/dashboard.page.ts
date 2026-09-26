import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, effect, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { DruckInfo, Einsatz, Geraetetraeger, OrgSettings, Trupp, TruppName } from './models';
import { RealtimeService } from './realtime.service';
import { SessionService } from './session.service';
import { ClockService } from './clock.service';
import { ThemeMode, ThemeStore } from './theme.store';
import { TranslationService } from './translation.service';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.page.html'
})
export class DashboardPage implements OnInit, OnDestroy {
  private readonly baseUrl = environment.apiBaseUrl;
  private timerId?: number;
  @ViewChild('druckInput') druckInput?: ElementRef<HTMLInputElement>;
  @ViewChild('dashboardSection') dashboardSection?: ElementRef<HTMLElement>;
  @ViewChild('confirmCancel') confirmCancel?: ElementRef<HTMLButtonElement>;
  @ViewChild('alarmPanel') alarmPanel?: ElementRef<HTMLElement>;
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  liveStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  themeMode: ThemeMode = 'light';
  mobileMetaOpen = false;

  currentEinsatz: Einsatz | null = null;
  trupps: Trupp[] = [];
  geraetetraeger: Geraetetraeger[] = [];
  truppnamen: TruppName[] = [];
  letzteEinsaetze: Einsatz[] = [];
  currentEpoch = Date.now();
  private notifiedWarn = new Set<string>();
  private notifiedMax = new Set<string>();
  private lastWarnAlert: Record<string, number> = {};
  private lastMaxAlert: Record<string, number> = {};
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

  detailsModal: {
    open: boolean;
    einsatz: Einsatz;
    trupps: Trupp[];
    loading: boolean;
  } | null = null;
  deleteModal: { open: boolean; einsatz: Einsatz } | null = null;

  toasts: { id: number; text: string; type: 'warn' | 'max' }[] = [];
  private toastId = 0;
  private lastLiveStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  // ackReady: Bestaetigen erst nach kurzer Verzoegerung moeglich, damit ein Tipp, der fuer einen anderen Dialog
  // gedacht war, den gerade erscheinenden Alarm nicht versehentlich bestaetigt.
  alarmModal: { open: boolean; trupp: Trupp; type: 'warn' | 'max'; ackReady: boolean } | null = null;
  // Bestaetigung fuer nicht umkehrbare Aktionen (Einsatz/Trupp beenden).
  confirmModal: { title: string; text: string; confirmLabel: string; action: () => void } | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private audioCtx: AudioContext | null = null;
  private remindedPressureChecks = new Set<string>();

  constructor(
    private http: HttpClient,
    private zone: NgZone,
    private realtime: RealtimeService,
    private session: SessionService,
    private clock: ClockService,
    private title: Title,
    public i18n: TranslationService
  ) {
    effect(() => {
      this.i18n.lang();
      this.updatePageTitle();
    });
  }

  private formatDateTime(value: string | null | undefined): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (v: number) => v.toString().padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${this.i18n.t('common.timeSuffix')}`;
  }

  ngOnInit(): void {
    this.loadTheme();
    this.updatePageTitle();
    this.setAutoAlarmzeitNow();
    this.setAutoStartzeitNow();
    this.loadActiveEinsatz();
    this.loadGeraetetraeger();
    this.loadTruppnamen();
    this.loadOrgSettings();
    this.loadLetzteEinsaetze();
    this.startClock();

    this.realtime.start();
    this.unsubscribeRealtime = this.realtime.onUpdate((type) => {
      if (type === 'einsatz' || type === 'trupp' || type === 'druck') {
        this.loadActiveEinsatz();
        this.loadLetzteEinsaetze();
      }
    });
    this.unsubscribeStatus = this.realtime.onStatus((status) => {
      if (status === 'disconnected' && this.lastLiveStatus !== 'disconnected') {
        this.pushToast(this.i18n.t('dashboard.liveOffline'), 'warn');
      }
      this.lastLiveStatus = status;
      this.liveStatus = status;
    });
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
    if (this.alarmModal) {
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

  // Bildschirm waehrend eines Einsatzes wach halten, sonst schaltet das Tablet ab und Alarme bleiben ungesehen.
  private async updateWakeLock(): Promise<void> {
    if (!this.currentEinsatz) {
      this.releaseWakeLock();
      return;
    }
    if (this.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') {
      return;
    }
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
    } catch {
      // z. B. Energiesparmodus; Anzeige laeuft trotzdem weiter
    }
  }

  private releaseWakeLock(): void {
    this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  // Der Browser gibt die Sperre beim Wechsel in den Hintergrund frei; beim Zurueckkehren neu anfordern.
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      this.updateWakeLock();
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

  statusLabel(trupp: Trupp): string {
    const status = this.statusFor(trupp, this.currentEpoch);
    switch (status) {
      case 'gruen':
        return this.i18n.t('dashboard.statusGreen');
      case 'gelb':
        return this.i18n.t('dashboard.statusYellow');
      case 'rot':
        return this.i18n.t('dashboard.statusRed');
      case 'beendet':
        return this.i18n.t('dashboard.statusFinished');
      default:
        return status;
    }
  }

  // Druckkontrolle nach etwa 1/3 und 2/3 der Einsatzzeit (FwDV 7). Faellig, solange nicht fuer beide
  // Personen mindestens so viele Messungen vorliegen, wie Kontrollpunkte erreicht sind.
  pressureCheckDue(trupp: Trupp, nowEpoch: number): 1 | 2 | null {
    if (trupp.endzeit) {
      return null;
    }
    const elapsedSec = this.elapsedSeconds(trupp, nowEpoch);
    const maxSec = trupp.maxzeitMin * 60;
    const stage = elapsedSec >= (maxSec * 2) / 3 ? 2 : elapsedSec >= maxSec / 3 ? 1 : 0;
    if (stage === 0) {
      return null;
    }
    const done = Math.min(trupp.druckCountPerson1, trupp.druckCountPerson2);
    return done < stage ? stage : null;
  }

  pressureCheckFraction(stage: 1 | 2): string {
    return stage === 1 ? '⅓' : '⅔';
  }

  private remindPressureCheck(trupp: Trupp, nowEpoch: number): void {
    const stage = this.pressureCheckDue(trupp, nowEpoch);
    if (!stage) {
      return;
    }
    const key = `${trupp.id}:${stage}`;
    if (this.remindedPressureChecks.has(key)) {
      return;
    }
    this.remindedPressureChecks.add(key);
    this.pushToast(
      this.i18n.t('dashboard.pressureCheckDueCrew', {
        name: trupp.bezeichnung,
        fraction: this.pressureCheckFraction(stage)
      }),
      'warn'
    );
    this.playBeep(1);
  }

  // Der Trupp muss sich nach dem Geraet mit dem niedrigsten Druck richten.
  lowestPressure(trupp: Trupp): number {
    const p1 = trupp.druckMessungenPerson1[0]?.druckBar ?? trupp.startdruckPerson1Bar;
    const p2 = trupp.druckMessungenPerson2[0]?.druckBar ?? trupp.startdruckPerson2Bar;
    return Math.min(p1, p2);
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

  ngOnDestroy(): void {
    this.session.monitoringActive.set(false);
    this.releaseWakeLock();
    this.audioCtx?.close().catch(() => undefined);
    if (this.timerId) {
      window.clearInterval(this.timerId);
    }
    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
    }
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
    }
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
    this.session.logout();
  }

  loadActiveEinsatz(): void {
    this.http.get<Einsatz[]>(`${this.baseUrl}/einsaetze/aktiv`).subscribe((list) => {
      this.currentEinsatz = list[0] ?? null;
      this.session.monitoringActive.set(this.currentEinsatz !== null);
      this.updateWakeLock();
      if (this.currentEinsatz) {
        this.loadTrupps();
      } else {
        this.trupps = [];
      }
    });
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

  get activeTruppnamen(): TruppName[] {
    return this.truppnamen.filter((t) => t.aktiv !== false);
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
      next: (einsatz) => {
        this.currentEinsatz = einsatz;
        this.trupps = [];
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
        this.loadActiveEinsatz();
        this.loadLetzteEinsaetze();
      },
      error: (err) => this.pushToast(this.apiError(err, 'dashboard.actionFailed'), 'warn')
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
        if (this.currentEinsatz?.id === einsatz.id) {
          this.currentEinsatz = null;
          this.trupps = [];
        }
        this.loadLetzteEinsaetze();
        this.loadActiveEinsatz();
        this.deleteModal = null;
      },
      error: (err) => {
        this.deleteModal = null;
        this.pushToast(this.apiError(err, 'dashboard.actionFailed'), 'warn');
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
          const sorted = [...list].sort((a, b) => {
            const aTime = this.parseEpoch(a.startzeit) ?? 0;
            const bTime = this.parseEpoch(b.startzeit) ?? 0;
            return aTime - bTime;
          });
          this.detailsModal.trupps = sorted;
          this.detailsModal.loading = false;
        }
      });
  }

  exportEinsatz(einsatz: Einsatz): void {
    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`)
      .subscribe((list) => {
        const formatMessungen = (values: DruckInfo[]) =>
          values
            .map((m) => `${m.druckBar} bar | ${this.formatDateTime(m.zeit)}`)
            .join(' | ');

        const einsatzStatus =
          einsatz.status === 'aktiv'
            ? this.i18n.t('dashboard.operationStateActive')
            : einsatz.status === 'beendet'
              ? this.i18n.t('dashboard.ended')
              : einsatz.status;

        const einsatzSheet = XLSX.utils.aoa_to_sheet([
          [this.i18n.t('dashboard.exportSectionIncident')],
          [
            this.i18n.t('dashboard.exportColName'),
            this.i18n.t('dashboard.exportColPlace'),
            this.i18n.t('dashboard.exportColAlarmTime'),
            this.i18n.t('dashboard.exportColStatus'),
            this.i18n.t('dashboard.exportColEndTime')
          ],
          [
            einsatz.name,
            einsatz.ort,
            this.formatDateTime(einsatz.alarmzeit),
            einsatzStatus,
            einsatz.endzeit ? this.formatDateTime(einsatz.endzeit) : '-'
          ]
        ]);

        const truppRows = [
          [
            this.i18n.t('dashboard.exportColCrewName'),
            this.i18n.t('dashboard.exportColPerson1'),
            this.i18n.t('dashboard.exportColPerson2'),
            this.i18n.t('dashboard.exportColStartTime'),
            this.i18n.t('dashboard.exportColEndTime'),
            this.i18n.t('dashboard.exportColStartPressureP1'),
            this.i18n.t('dashboard.exportColStartPressureP2'),
            this.i18n.t('dashboard.exportColWarnTime'),
            this.i18n.t('dashboard.exportColMaxTime'),
            this.i18n.t('dashboard.exportColMeasurementsP1'),
            this.i18n.t('dashboard.exportColMeasurementsP2')
          ],
          ...list.map((t) => [
            t.bezeichnung,
            t.person1Name,
            t.person2Name,
            this.formatDateTime(t.startzeit),
            t.endzeit ? this.formatDateTime(t.endzeit) : '-',
            t.startdruckPerson1Bar,
            t.startdruckPerson2Bar,
            t.warnzeitMin,
            t.maxzeitMin,
            formatMessungen(t.druckMessungenPerson1 || []),
            formatMessungen(t.druckMessungenPerson2 || [])
          ])
        ];

        const truppSheet = XLSX.utils.aoa_to_sheet(truppRows);

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, einsatzSheet, this.i18n.t('dashboard.exportSheetIncident'));
        XLSX.utils.book_append_sheet(workbook, truppSheet, this.i18n.t('dashboard.exportSheetCrews'));

        const safeName = (einsatz.name || 'Einsatz')
          .replace(/[^a-z0-9äöüÄÖÜß_\\-]+/gi, '_');
        const alarm = new Date(einsatz.alarmzeit);
        const stamp = Number.isNaN(alarm.getTime()) ? new Date() : alarm;
        const pad = (v: number) => v.toString().padStart(2, '0');
        const dateLabel = `${pad(stamp.getDate())}.${pad(stamp.getMonth() + 1)}.${stamp.getFullYear()}`;
        const filename = `${this.i18n.t('common.appName')}_Einsatzbericht_${safeName}_${dateLabel}.xlsx`;
        XLSX.writeFile(workbook, filename, { compression: true });

        // no auto email client open after export
      });
  }

  exportEinsatzPdf(einsatz: Einsatz): void {
    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${einsatz.id}/trupps`)
      .subscribe((list) => {
        const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
        const margin = 40;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        let y = 44;

        const drawHeader = () => {
          doc.setFillColor(36, 23, 20);
          doc.rect(0, 0, pageWidth, 80, 'F');
          doc.setTextColor(246, 239, 232);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.text(
            this.i18n.t('dashboard.pdfTitle', { appName: this.i18n.t('common.appName') }),
            margin,
            48
          );
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(
            this.i18n.t('dashboard.pdfCreatedAt', { value: new Date().toLocaleString() }),
            margin,
            66
          );
          doc.setTextColor(33, 33, 33);
          y = 96;
        };

        drawHeader();

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(this.i18n.t('dashboard.pdfIncidentData'), margin, y);
        y += 16;

        doc.setFont('helvetica', 'normal');
        const einsatzStatus =
          einsatz.status === 'aktiv'
            ? this.i18n.t('dashboard.operationStateActive')
            : einsatz.status === 'beendet'
              ? this.i18n.t('dashboard.ended')
              : einsatz.status;
        const info = [
          [this.i18n.t('dashboard.exportSectionIncident'), einsatz.name],
          [this.i18n.t('dashboard.exportColPlace'), einsatz.ort],
          [this.i18n.t('dashboard.exportColAlarmTime'), this.formatDateTime(einsatz.alarmzeit)],
          [this.i18n.t('dashboard.exportColStatus'), einsatzStatus],
          [this.i18n.t('dashboard.end'), this.formatDateTime(einsatz.endzeit ?? '')]
        ];
        for (const [label, value] of info) {
          doc.setTextColor(90, 70, 60);
          doc.text(`${label}:`, margin, y);
          doc.setTextColor(33, 33, 33);
          doc.text(String(value), margin + 90, y);
          y += 16;
        }
        y += 10;

        const formatMessungen = (values: DruckInfo[]) =>
          values.map((m) => `${m.druckBar} bar | ${this.formatDateTime(m.zeit)}`);

        const addTableHeader = () => {
          doc.setFillColor(240, 140, 42);
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.rect(margin, y, pageWidth - margin * 2, 24, 'F');
          const headers = [
            this.i18n.t('dashboard.pdfCrew'),
            this.i18n.t('dashboard.pdfPersons'),
            this.i18n.t('dashboard.start'),
            this.i18n.t('dashboard.pdfPressure'),
            this.i18n.t('dashboard.pdfWarnMax'),
            this.i18n.t('dashboard.pdfMeasurements')
          ];
          const cols = [110, 150, 145, 70, 70, pageWidth - margin * 2 - 545];
          let x = margin + 8;
          headers.forEach((h, i) => {
            doc.text(h, x, y + 16);
            x += cols[i];
          });
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(33, 33, 33);
          y += 28;
        };

        addTableHeader();

        for (const t of list) {
          const cols = [110, 150, 145, 70, 70, pageWidth - margin * 2 - 545];
          const m1 = formatMessungen(t.druckMessungenPerson1 || []);
          const m2 = formatMessungen(t.druckMessungenPerson2 || []);
          const mLines = [
            ...(m1.length ? m1.map((m) => `P1: ${m}`) : []),
            ...(m2.length ? m2.map((m) => `P2: ${m}`) : [])
          ];
          const mText = mLines.length ? mLines.join('\n') : '-';
          const wrapped = doc.splitTextToSize(mText, cols[5] - 8);
          const rowHeight = Math.max(48, 20 + wrapped.length * 12);
          if (y + rowHeight > pageHeight - 40) {
            doc.addPage();
            drawHeader();
            addTableHeader();
          }
          doc.setDrawColor(225, 220, 212);
          doc.rect(margin, y, pageWidth - margin * 2, rowHeight);

          let x = margin + 8;
          doc.text(String(t.bezeichnung), x, y + 16);
          x += cols[0];
          doc.text(`P1: ${t.person1Name}\nP2: ${t.person2Name}`, x, y + 14);
          x += cols[1];
          doc.text(this.formatDateTime(t.startzeit), x, y + 16);
          x += cols[2];
          doc.text(`P1 ${t.startdruckPerson1Bar}\nP2 ${t.startdruckPerson2Bar}`, x, y + 14);
          x += cols[3];
          doc.text(`${t.warnzeitMin}/${t.maxzeitMin}`, x, y + 16);
          x += cols[4];
          doc.text(wrapped, x, y + 16);

          y += rowHeight;
        }

        const alarm = new Date(einsatz.alarmzeit);
        const stamp = Number.isNaN(alarm.getTime())
          ? new Date()
          : alarm;
        const pad = (v: number) => v.toString().padStart(2, '0');
        const dateLabel = `${pad(stamp.getDate())}.${pad(stamp.getMonth() + 1)}.${stamp.getFullYear()}`;
        const safeName = (einsatz.name || 'Einsatz')
          .replace(/[^a-z0-9äöüÄÖÜß_\\-]+/gi, '_');
        doc.save(`${this.i18n.t('common.appName')}_Einsatzbericht_${safeName}_${dateLabel}.pdf`);
      });
  }

  closeEinsatzDetails(): void {
    this.detailsModal = null;
  }

  loadTrupps(): void {
    if (!this.currentEinsatz) {
      return;
    }
    this.http
      .get<Trupp[]>(`${this.baseUrl}/einsaetze/${this.currentEinsatz.id}/trupps`)
      .subscribe((list) => {
        const mapped = list.map((t) => this.normalizeTrupp(t));
        this.trupps = [...mapped].sort((a, b) => {
          const aActive = a.endzeit ? 1 : 0;
          const bActive = b.endzeit ? 1 : 0;
          if (aActive !== bActive) {
            return aActive - bActive;
          }
          return (a.startEpoch ?? 0) - (b.startEpoch ?? 0);
        });
        this.checkThresholds();
      });
  }

  addTrupp(): void {
    if (!this.currentEinsatz) {
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
    this.http
      .post<Trupp>(`${this.baseUrl}/einsaetze/${this.currentEinsatz.id}/trupps`, payload)
      .subscribe({
        next: (created) => {
          if (created) {
            this.trupps = [...this.trupps, this.normalizeTrupp(created)];
          }
          this.truppForm.truppNameId = '';
          this.truppForm.person1Id = '';
          this.truppForm.person2Id = '';
          this.setAutoStartzeitNow();
          this.loadTrupps();
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

  private normalizeTrupp(trupp: Trupp): Trupp {
    const messungen1 = trupp.druckMessungenPerson1 ?? [];
    const messungen2 = trupp.druckMessungenPerson2 ?? [];
    const endzeit = trupp.endzeit ? trupp.endzeit : null;
    return {
      ...trupp,
      endzeit,
      druckMessungenPerson1: messungen1,
      druckMessungenPerson2: messungen2,
      druckCountPerson1: trupp.druckCountPerson1 ?? messungen1.length,
      druckCountPerson2: trupp.druckCountPerson2 ?? messungen2.length,
      startEpoch: this.parseEpoch(trupp.startzeit),
      endEpoch: endzeit ? this.parseEpoch(endzeit) : null
    };
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

  private doEndTrupp(trupp: Trupp): void {
    this.http.post<Trupp>(`${this.baseUrl}/trupps/${trupp.id}/beenden`, {}).subscribe({
      next: () => this.loadTrupps(),
      error: (err) => this.pushToast(this.apiError(err, 'dashboard.actionFailed'), 'warn')
    });
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

  saveDruckModal(): void {
    if (!this.druckModal) {
      return;
    }
    const value = Number(this.druckModal.value);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const maxAllowed = this.maxDruckForModal();
    if (maxAllowed !== null && value > maxAllowed) {
      this.druckModalError = this.i18n.t('dashboard.pressureMaxValue', { value: maxAllowed });
      this.pushToast(this.i18n.t('dashboard.pressureTooHigh', { value: maxAllowed }), 'warn');
      return;
    }
    this.http
      .post(`${this.baseUrl}/trupps/${this.druckModal.trupp.id}/druckmessungen`, {
        personId: this.druckModal.personId,
        druckBar: value
      })
      .subscribe({
        next: () => {
          this.closeDruckModal();
          this.loadTrupps();
        },
        error: (err) => {
          // Modal offen lassen, damit der Wert nicht verloren geht und erneut gesendet werden kann.
          this.druckModalError = this.apiError(err, 'dashboard.actionFailed');
        }
      });
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

  statusFor(trupp: Trupp, nowEpoch: number): 'gruen' | 'gelb' | 'rot' | 'beendet' {
    if (trupp.endzeit) {
      return 'beendet';
    }
    const elapsedMin = this.elapsedMinutes(trupp, nowEpoch);
    if (elapsedMin >= trupp.maxzeitMin) {
      return 'rot';
    }
    if (elapsedMin >= trupp.warnzeitMin) {
      return 'gelb';
    }
    return 'gruen';
  }

  remainingSeconds(trupp: Trupp, nowEpoch: number): number {
    const elapsedSec = this.elapsedSeconds(trupp, nowEpoch);
    return Math.max(Math.ceil(trupp.maxzeitMin * 60 - elapsedSec), 0);
  }

  remainingDisplay(trupp: Trupp, nowEpoch: number): string {
    const totalSeconds = this.remainingSeconds(trupp, nowEpoch);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (v: number) => v.toString().padStart(2, '0');
    return `${minutes}:${pad(seconds)}`;
  }

  durationDisplay(trupp: Trupp): string {
    const start = trupp.startEpoch ?? this.parseEpoch(trupp.startzeit) ?? 0;
    const end = trupp.endEpoch ?? (trupp.endzeit ? this.parseEpoch(trupp.endzeit) ?? start : start);
    const totalSeconds = Math.max(Math.floor((end - start) / 1000), 0);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (v: number) => v.toString().padStart(2, '0');
    return `${minutes}:${pad(seconds)}`;
  }

  private elapsedMinutes(trupp: Trupp, nowEpoch: number): number {
    const start = trupp.startEpoch ?? this.parseEpoch(trupp.startzeit) ?? 0;
    const end = trupp.endEpoch ?? (trupp.endzeit ? this.parseEpoch(trupp.endzeit) ?? nowEpoch : nowEpoch);
    return Math.floor((end - start) / 60000);
  }

  private elapsedSeconds(trupp: Trupp, nowEpoch: number): number {
    const start = trupp.startEpoch ?? this.parseEpoch(trupp.startzeit) ?? 0;
    const end = trupp.endEpoch ?? (trupp.endzeit ? this.parseEpoch(trupp.endzeit) ?? nowEpoch : nowEpoch);
    return Math.floor((end - start) / 1000);
  }

  private parseEpoch(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }
    const direct = Date.parse(value);
    if (!Number.isNaN(direct)) {
      return direct;
    }
    const withZ = Date.parse(`${value}Z`);
    if (!Number.isNaN(withZ)) {
      return withZ;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
    if (!match) {
      return null;
    }
    const [, y, m, d, hh, mm, ss] = match;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss ?? '0')
    ).getTime();
  }

  private startClock(): void {
    this.currentEpoch = this.clock.now();
    this.timerId = window.setInterval(() => {
      this.zone.run(() => {
        this.currentEpoch = this.clock.now();
        this.checkThresholds();
      });
    }, 1000);
  }

  private checkThresholds(): void {
    for (const trupp of this.trupps) {
      if (trupp.endzeit) {
        continue;
      }
      const now = this.currentEpoch;
      const elapsedMin = this.elapsedMinutes(trupp, now);
      this.remindPressureCheck(trupp, now);
      if (elapsedMin >= trupp.maxzeitMin && !trupp.maxAcked) {
        if (this.shouldAlert(this.lastMaxAlert, trupp.id, now, 15000)) {
          this.pushToast(this.i18n.t('dashboard.maxReachedCrew', { name: trupp.bezeichnung }), 'max');
          this.playBeep(4, true);
          this.triggerVibration([250, 120, 250, 120, 250]);
          this.logEvent(trupp, 'max');
          this.openAlarmModal(trupp, 'max');
        }
      } else if (elapsedMin >= trupp.warnzeitMin && !trupp.warnAcked) {
        if (this.shouldAlert(this.lastWarnAlert, trupp.id, now, 30000)) {
          this.pushToast(this.i18n.t('dashboard.warnReachedCrew', { name: trupp.bezeichnung }), 'warn');
          this.playBeep(2);
          this.triggerVibration([180, 120, 180]);
          this.logEvent(trupp, 'warn');
          this.openAlarmModal(trupp, 'warn');
        }
      }
    }
  }

  // Protokolliert das erste Ausloesen je Trupp und Typ; Wiederholungen des Alarms erzeugen keine weiteren Eintraege.
  private logEvent(trupp: Trupp, type: 'warn' | 'max'): void {
    const notified = type === 'warn' ? this.notifiedWarn : this.notifiedMax;
    if (notified.has(trupp.id)) {
      return;
    }
    notified.add(trupp.id);
    this.http.post(`${this.baseUrl}/trupps/${trupp.id}/events`, { typ: type }).subscribe({
      error: () => notified.delete(trupp.id)
    });
  }

  private shouldAlert(store: Record<string, number>, id: string, now: number, intervalMs: number): boolean {
    const last = store[id] ?? 0;
    if (now - last < intervalMs) {
      return false;
    }
    store[id] = now;
    return true;
  }

  private openAlarmModal(trupp: Trupp, type: 'warn' | 'max'): void {
    if (this.alarmModal?.open) {
      return;
    }
    const modal = { open: true, trupp, type, ackReady: false };
    this.alarmModal = modal;
    // Fokus auf den Dialog statt auf den Button: Enter aus einem anderen Eingabefeld bestaetigt nicht.
    this.focusSoon(() => this.alarmPanel);
    window.setTimeout(() => (modal.ackReady = true), 1500);
  }

  acknowledgeAlarm(): void {
    if (!this.alarmModal?.ackReady) {
      return;
    }
    const { trupp, type } = this.alarmModal;
    const ackType = type === 'warn' ? 'warn_ack' : 'max_ack';
    if (type === 'warn') {
      trupp.warnAcked = true;
    } else {
      trupp.maxAcked = true;
    }
    this.alarmModal = null;
    // Erst nach dem Speichern neu laden, sonst ueberschreibt der alte Serverstand die Quittierung.
    this.http.post(`${this.baseUrl}/trupps/${trupp.id}/events`, { typ: ackType }).subscribe({
      next: () => this.loadTrupps(),
      error: (err) => this.pushToast(this.apiError(err, 'dashboard.actionFailed'), 'warn')
    });
  }

  private triggerVibration(pattern: number[]): void {
    try {
      if (navigator && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch {
      // ignore
    }
  }

  // Browser blockieren Ton bis zur ersten Beruehrung; waehrend eines Einsatzes wird dann ein Hinweis angezeigt.
  get audioLocked(): boolean {
    return !this.audioCtx || this.audioCtx.state !== 'running';
  }

  // Ein gemeinsamer AudioContext, freigeschaltet bei der ersten Beruehrung/Taste. Neue Contexts ohne
  // Nutzerinteraktion bleiben in Browsern stumm – genau dann, wenn der Alarm kommt.
  @HostListener('document:pointerdown')
  @HostListener('document:keydown')
  unlockAudio(): void {
    try {
      this.audioCtx ??= new AudioContext();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => undefined);
      }
    } catch {
      // kein Audio verfuegbar
    }
  }

  // Deutlich hoerbarer Signalton: warn = 2 Toene, max = 4 Toene im Wechsel, Erinnerung = 1 Ton.
  private playBeep(times: number, alternate = false): void {
    try {
      this.audioCtx ??= new AudioContext();
      const ctx = this.audioCtx;
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => undefined);
        return;
      }
      const toneSec = 0.3;
      const gapSec = 0.15;
      for (let i = 0; i < times; i += 1) {
        const start = ctx.currentTime + i * (toneSec + gapSec);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = alternate && i % 2 === 1 ? 1320 : 880;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.setValueAtTime(0, start + toneSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + toneSec);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      }
    } catch {
      // ignore audio errors
    }
  }

  private pushToast(text: string, type: 'warn' | 'max'): void {
    const id = ++this.toastId;
    this.toasts = [...this.toasts, { id, text, type }];
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 6000);
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

