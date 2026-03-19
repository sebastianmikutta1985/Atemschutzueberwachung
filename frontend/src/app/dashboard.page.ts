import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { DruckInfo, Einsatz, Geraetetraeger, OrgSettings, Trupp, TruppName } from './models';
import { RealtimeService } from './realtime.service';
import { ThemeMode, ThemeStore } from './theme.store';
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
  openSelect: 'trupp' | 'p1' | 'p2' | null = null;
  private unsubscribeRealtime?: () => void;
  private unsubscribeStatus?: () => void;
  liveStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  themeMode: ThemeMode = 'light';

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
  errorMessage = '';

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
  alarmModal: { open: boolean; trupp: Trupp; type: 'warn' | 'max' } | null = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone,
    private router: Router,
    private realtime: RealtimeService
  ) {}

  private formatDateTime(value: string | null | undefined): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (v: number) => v.toString().padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())} Uhr`;
  }

  ngOnInit(): void {
    this.loadTheme();
    const now = new Date();
    this.einsatzForm.alarmzeit = this.toLocalInputValue(now);
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

  toggleTheme(): void {
    const themeKey = AuthStore.themeKey();
    this.themeMode = this.themeMode === 'dark' ? 'light' : 'dark';
    ThemeStore.save(this.themeMode, themeKey);
    ThemeStore.apply(this.themeMode);
  }

  @HostListener('document:click')
  closeOpenSelect(): void {
    this.openSelect = null;
  }

  toggleSelect(key: 'trupp' | 'p1' | 'p2', event: MouseEvent): void {
    event.stopPropagation();
    if (!this.currentEinsatz) {
      return;
    }
    this.openSelect = this.openSelect === key ? null : key;
  }

  selectTruppName(id: string): void {
    if (this.isTruppNameInActiveTrupp(id)) {
      return;
    }
    this.truppForm.truppNameId = id;
    this.openSelect = null;
  }

  selectPerson(id: string, target: 'p1' | 'p2'): void {
    if (this.isPersonInActiveTrupp(id)) {
      return;
    }
    if (target === 'p1') {
      if (id === this.truppForm.person2Id) {
        return;
      }
      this.truppForm.person1Id = id;
    } else {
      if (id === this.truppForm.person1Id) {
        return;
      }
      this.truppForm.person2Id = id;
    }
    this.openSelect = null;
  }

  truppNameLabel(id: string): string {
    if (!id) {
      return 'Bitte wählen';
    }
    const found = this.truppnamen.find((t) => t.id === id);
    return found?.name ?? 'Bitte wählen';
  }

  personLabel(id: string): string {
    if (!id) {
      return 'Bitte wählen';
    }
    const found = this.geraetetraeger.find((t) => t.id === id);
    if (!found) {
      return 'Bitte wählen';
    }
    return `${found.nachname} ${found.vorname}${found.funkrufname ? ' (' + found.funkrufname + ')' : ''}`;
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

  get authInfo(): { orgName: string; orgCode: string; role: string } | null {
    const auth = AuthStore.load();
    if (!auth) {
      return null;
    }
    return { orgName: auth.orgName, orgCode: auth.orgCode, role: auth.role };
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

  loadActiveEinsatz(): void {
    this.http.get<Einsatz[]>(`${this.baseUrl}/einsaetze/aktiv`).subscribe((list) => {
      this.currentEinsatz = list[0] ?? null;
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
      alarmzeit: this.einsatzForm.alarmzeit || null
    };

    this.http.post<Einsatz>(`${this.baseUrl}/einsaetze`, payload).subscribe({
      next: (einsatz) => {
        this.currentEinsatz = einsatz;
        this.trupps = [];
        this.loadLetzteEinsaetze();
      },
      error: (err) => {
        if (err?.status === 401) {
          AuthStore.clear();
          this.router.navigateByUrl('/login');
        }
        this.errorMessage = 'Einsatz konnte nicht gestartet werden.';
      }
    });
  }

  endEinsatz(): void {
    if (!this.currentEinsatz) {
      return;
    }

    this.http.post<Einsatz>(`${this.baseUrl}/einsaetze/${this.currentEinsatz.id}/beenden`, {}).subscribe(() => {
      this.loadActiveEinsatz();
      this.loadLetzteEinsaetze();
    });
  }

  deleteEinsatz(einsatz: Einsatz): void {
    this.deleteModal = { open: true, einsatz };
  }

  confirmDeleteEinsatz(): void {
    if (!this.deleteModal) {
      return;
    }
    const einsatz = this.deleteModal.einsatz;
    this.http.delete(`${this.baseUrl}/einsaetze/${einsatz.id}`).subscribe(() => {
      if (this.currentEinsatz?.id === einsatz.id) {
        this.currentEinsatz = null;
        this.trupps = [];
      }
      this.loadLetzteEinsaetze();
      this.loadActiveEinsatz();
      this.deleteModal = null;
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
            .map((m) => `${m.druckBar} bar @ ${this.formatDateTime(m.zeit)}`)
            .join(' | ');

        const einsatzSheet = XLSX.utils.aoa_to_sheet([
          ['Einsatz'],
          ['Name', 'Ort', 'Alarmzeit', 'Status', 'Endzeit'],
          [
            einsatz.name,
            einsatz.ort,
            this.formatDateTime(einsatz.alarmzeit),
            einsatz.status,
            einsatz.endzeit ? this.formatDateTime(einsatz.endzeit) : '-'
          ]
        ]);

        const truppRows = [
          [
            'Bezeichnung',
            'Person 1',
            'Person 2',
            'Startzeit',
            'Endzeit',
            'Startdruck P1',
            'Startdruck P2',
            'Warnzeit (min)',
            'Maxzeit (min)',
            'Messungen P1',
            'Messungen P2'
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
        XLSX.utils.book_append_sheet(workbook, einsatzSheet, 'Einsatz');
        XLSX.utils.book_append_sheet(workbook, truppSheet, 'Trupps');

        const safeName = (einsatz.name || 'einsatz').replace(/[^a-z0-9-_]+/gi, '_');
        const filename = `${safeName}_${einsatz.id}.xlsx`;
        XLSX.writeFile(workbook, filename, { compression: true });

        const subject = `ATS Export - ${einsatz.name}`;
        const body = `Bitte Einsatz-Export im Anhang einfügen.\n\nEinsatz: ${einsatz.name}\nOrt: ${einsatz.ort}\nAlarm: ${einsatz.alarmzeit}`;
        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.setTimeout(() => {
          window.location.href = mailto;
        }, 200);
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
          doc.text('AirGuard Einsatzbericht', margin, 48);
          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.text(`Stand: ${new Date().toLocaleString()}`, margin, 66);
          doc.setTextColor(33, 33, 33);
          y = 96;
        };

        drawHeader();

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Einsatzdaten', margin, y);
        y += 16;

        doc.setFont('helvetica', 'normal');
        const formatDateTime = (value: string | null | undefined) => {
          if (!value) return '-';
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return value;
          const pad = (v: number) => v.toString().padStart(2, '0');
          return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
            d.getHours()
          )}:${pad(d.getMinutes())}:${pad(d.getSeconds())} Uhr`;
        };
        const info = [
          ['Einsatz', einsatz.name],
          ['Ort', einsatz.ort],
          ['Alarmzeit', formatDateTime(einsatz.alarmzeit)],
          ['Status', einsatz.status],
          ['Ende', formatDateTime(einsatz.endzeit ?? '')]
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
          values.map((m) => `${m.druckBar} bar @ ${m.zeit}`).join(' | ');

        const addTableHeader = () => {
          doc.setFillColor(240, 140, 42);
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.rect(margin, y, pageWidth - margin * 2, 24, 'F');
          const headers = ['Trupp', 'P1 / P2', 'Start', 'Druck', 'Warn/Max', 'Messungen'];
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
          const rowHeight = 48;
          if (y + rowHeight > pageHeight - 40) {
            doc.addPage();
            drawHeader();
            addTableHeader();
          }
          doc.setDrawColor(225, 220, 212);
          doc.rect(margin, y, pageWidth - margin * 2, rowHeight);

          const cols = [110, 150, 145, 70, 70, pageWidth - margin * 2 - 545];
          let x = margin + 8;
          doc.text(String(t.bezeichnung), x, y + 16);
          x += cols[0];
          doc.text(`P1: ${t.person1Name}\nP2: ${t.person2Name}`, x, y + 14);
          x += cols[1];
          doc.text(formatDateTime(t.startzeit), x, y + 16);
          x += cols[2];
          doc.text(`P1 ${t.startdruckPerson1Bar}\nP2 ${t.startdruckPerson2Bar}`, x, y + 14);
          x += cols[3];
          doc.text(`${t.warnzeitMin}/${t.maxzeitMin}`, x, y + 16);
          x += cols[4];
          const m1 = formatMessungen(t.druckMessungenPerson1 || []);
          const m2 = formatMessungen(t.druckMessungenPerson2 || []);
          const mText = [m1 ? `P1: ${m1}` : '', m2 ? `P2: ${m2}` : ''].filter(Boolean).join(' | ');
          doc.text(mText || '-', x, y + 16, { maxWidth: cols[5] - 8 });

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
        doc.save(`Einsatzbericht_${safeName}_${dateLabel}.pdf`);
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
        const mapped = list.map((t) => ({
          ...t,
          endzeit: t.endzeit ? t.endzeit : null,
          startEpoch: this.parseEpoch(t.startzeit),
          endEpoch: t.endzeit ? this.parseEpoch(t.endzeit) : null
        }));
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

    if (this.truppForm.startzeit === this.lastAutoStartzeit) {
      this.setAutoStartzeitNow();
    }

    const payload = {
      truppNameId: this.truppForm.truppNameId,
      person1Id: this.truppForm.person1Id,
      person2Id: this.truppForm.person2Id,
      startdruckPerson1Bar: this.truppForm.startdruckPerson1Bar,
      startdruckPerson2Bar: this.truppForm.startdruckPerson2Bar,
      startzeit: this.truppForm.startzeit || null,
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

    this.http
      .post<Trupp>(`${this.baseUrl}/einsaetze/${this.currentEinsatz.id}/trupps`, payload)
      .subscribe((created) => {
      if (created) {
        this.trupps = [...this.trupps, created];
      }
      this.truppForm.truppNameId = '';
      this.truppForm.person1Id = '';
      this.truppForm.person2Id = '';
      this.setAutoStartzeitNow();
      this.loadTrupps();
    });
  }

  endTrupp(trupp: Trupp): void {
    this.http.post<Trupp>(`${this.baseUrl}/trupps/${trupp.id}/beenden`, {}).subscribe(() => {
      this.loadTrupps();
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
      this.druckModalError = `Maximal ${maxAllowed} bar.`;
      this.pushToast(`Druck zu hoch: maximal ${maxAllowed} bar.`, 'warn');
      return;
    }
    this.http
      .post(`${this.baseUrl}/trupps/${this.druckModal.trupp.id}/druckmessungen`, {
        personId: this.druckModal.personId,
        druckBar: value
      })
      .subscribe(() => {
        this.closeDruckModal();
        this.loadTrupps();
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
    this.currentEpoch = Date.now();
    this.timerId = window.setInterval(() => {
      this.zone.run(() => {
        this.currentEpoch = Date.now();
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
      if (elapsedMin >= trupp.maxzeitMin && !trupp.maxAcked) {
        if (this.shouldAlert(this.lastMaxAlert, trupp.id, now, 15000)) {
          this.pushToast(`Maxzeit erreicht: ${trupp.bezeichnung}`, 'max');
          this.playBeep(2);
          this.triggerVibration([250, 120, 250, 120, 250]);
          this.logEvent(trupp, 'max');
          this.openAlarmModal(trupp, 'max');
        }
      } else if (elapsedMin >= trupp.warnzeitMin && !trupp.warnAcked) {
        if (this.shouldAlert(this.lastWarnAlert, trupp.id, now, 30000)) {
          this.pushToast(`Warnzeit erreicht: ${trupp.bezeichnung}`, 'warn');
          this.playBeep(1);
          this.triggerVibration([180, 120, 180]);
          this.logEvent(trupp, 'warn');
          this.openAlarmModal(trupp, 'warn');
        }
      }
    }
  }

  private logEvent(trupp: Trupp, type: 'warn' | 'max' | 'warn_ack' | 'max_ack'): void {
    this.http.post(`${this.baseUrl}/trupps/${trupp.id}/events`, { type }).subscribe();
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
    this.alarmModal = { open: true, trupp, type };
  }

  acknowledgeAlarm(): void {
    if (!this.alarmModal) {
      return;
    }
    const { trupp, type } = this.alarmModal;
    if (type === 'warn') {
      trupp.warnAcked = true;
      this.logEvent(trupp, 'warn_ack');
    } else {
      trupp.maxAcked = true;
      this.logEvent(trupp, 'max_ack');
    }
    this.alarmModal = null;
    this.loadTrupps();
  }

  closeAlarmModal(): void {
    this.alarmModal = null;
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

  private playBeep(times: number): void {
    try {
      const ctx = new AudioContext();
      let count = 0;
      const play = () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.05;
        osc.start();
        setTimeout(() => {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
          count += 1;
          if (count < times) {
            setTimeout(play, 180);
          } else {
            ctx.close();
          }
        }, 120);
      };
      play();
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
    const now = new Date();
    const value = this.toLocalInputValue(now);
    this.truppForm.startzeit = value;
    this.lastAutoStartzeit = value;
  }
}
