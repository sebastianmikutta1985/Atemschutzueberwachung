import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  private readonly baseUrl = 'http://localhost:5000/api';
  private timerId?: number;

  currentEinsatz: Einsatz | null = null;
  trupps: Trupp[] = [];
  geraetetraeger: Geraetetraeger[] = [];
  truppnamen: TruppName[] = [];
  letzteEinsaetze: Einsatz[] = [];
  currentEpoch = Date.now();
  private notifiedWarn = new Set<string>();
  private notifiedMax = new Set<string>();

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

  editingTruppNameId: string | null = null;
  editingTruppNameValue = '';

  druckModal: {
    open: boolean;
    trupp: Trupp;
    personId: string;
    personName: string;
    value: number | null;
    last: DruckInfo[];
  } | null = null;

  detailsModal: {
    open: boolean;
    einsatz: Einsatz;
    trupps: Trupp[];
    loading: boolean;
  } | null = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    const now = new Date();
    this.einsatzForm.alarmzeit = this.toLocalInputValue(now);
    this.setAutoStartzeitNow();
    this.loadActiveEinsatz();
    this.loadGeraetetraeger();
    this.loadTruppnamen();
    this.loadLetzteEinsaetze();
    this.startClock();
  }

  ngOnDestroy(): void {
    if (this.timerId) {
      window.clearInterval(this.timerId);
    }
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
      this.letzteEinsaetze = list;
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
      if (!this.truppForm.truppNameId || !list.some((t) => t.id === this.truppForm.truppNameId && t.aktiv)) {
        const firstActive = list.find((t) => t.aktiv);
        this.truppForm.truppNameId = firstActive?.id ?? '';
      }
    });
  }

  createEinsatz(): void {
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

    this.http.post<Einsatz>(`${this.baseUrl}/einsaetze`, payload).subscribe((einsatz) => {
      this.currentEinsatz = einsatz;
      this.trupps = [];
      this.loadLetzteEinsaetze();
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
    const ok = window.confirm(`Einsatz "${einsatz.name}" wirklich loeschen?`);
    if (!ok) {
      return;
    }

    this.http.delete(`${this.baseUrl}/einsaetze/${einsatz.id}`).subscribe(() => {
      if (this.currentEinsatz?.id === einsatz.id) {
        this.currentEinsatz = null;
        this.trupps = [];
      }
      this.loadLetzteEinsaetze();
      this.loadActiveEinsatz();
    });
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

  toggleGeraetetraeger(traeger: Geraetetraeger): void {
    const payload = {
      vorname: traeger.vorname,
      nachname: traeger.nachname,
      funkrufname: traeger.funkrufname ?? '',
      aktiv: !traeger.aktiv
    };

    this.http
      .put<Geraetetraeger>(`${this.baseUrl}/geraetetraeger/${traeger.id}`, payload)
      .subscribe(() => {
        this.loadGeraetetraeger();
      });
  }

  deleteGeraetetraeger(traeger: Geraetetraeger): void {
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
      if (this.truppForm.truppNameId === item.id) {
        this.truppForm.truppNameId = '';
      }
      this.loadTruppnamen();
    });
  }

  get activeTruppnamen(): TruppName[] {
    return this.truppnamen.filter((t) => t.aktiv);
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
  }

  closeDruckModal(): void {
    this.druckModal = null;
  }

  saveDruckModal(): void {
    if (!this.druckModal) {
      return;
    }
    const value = Number(this.druckModal.value);
    if (!Number.isFinite(value) || value <= 0) {
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

  moveTruppName(index: number, direction: -1 | 1): void {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.truppnamen.length) {
      return;
    }
    const updated = [...this.truppnamen];
    const [item] = updated.splice(index, 1);
    updated.splice(newIndex, 0, item);
    this.truppnamen = updated;
    this.saveTruppnamenOrder();
  }

  private saveTruppnamenOrder(): void {
    const ids = this.truppnamen.map((t) => t.id);
    this.http.post(`${this.baseUrl}/truppnamen/reorder`, { ids }).subscribe(() => {
      this.loadTruppnamen();
    });
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

  remainingMinutes(trupp: Trupp, nowEpoch: number): number {
    const elapsedMin = this.elapsedMinutes(trupp, nowEpoch);
    return Math.max(trupp.maxzeitMin - elapsedMin, 0);
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
      if (elapsedMin >= trupp.warnzeitMin && !this.notifiedWarn.has(trupp.id)) {
        this.notifiedWarn.add(trupp.id);
        this.pushToast(`Warnzeit erreicht: ${trupp.bezeichnung}`, 'warn');
        this.playBeep(1);
        this.logEvent(trupp, 'warn');
      }
      if (elapsedMin >= trupp.maxzeitMin && !this.notifiedMax.has(trupp.id)) {
        this.notifiedMax.add(trupp.id);
        this.pushToast(`Maxzeit erreicht: ${trupp.bezeichnung}`, 'max');
        this.playBeep(2);
        this.logEvent(trupp, 'max');
      }
    }
  }

  private logEvent(trupp: Trupp, typ: 'warn' | 'max'): void {
    this.http
      .post(`${this.baseUrl}/trupps/${trupp.id}/events`, {
        typ,
        nachricht: typ === 'warn' ? 'Warnzeit erreicht' : 'Maxzeit erreicht'
      })
      .subscribe();
  }

  private playBeep(times: number): void {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + i * 0.35;
        osc.start(start);
        osc.stop(start + 0.2);
      }
    } catch {
      // ignore audio errors
    }
  }

  toasts: { id: number; text: string; type: 'warn' | 'max' }[] = [];
  private toastId = 0;

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

interface Einsatz {
  id: string;
  name: string;
  ort: string;
  alarmzeit: string;
  status: string;
  endzeit?: string | null;
}

interface Trupp {
  id: string;
  einsatzId: string;
  bezeichnung: string;
  person1Id: string;
  person2Id: string;
  person1Name: string;
  person2Name: string;
  startdruckPerson1Bar: number;
  startdruckPerson2Bar: number;
  startzeit: string;
  warnzeitMin: number;
  maxzeitMin: number;
  endzeit?: string | null;
  startEpoch?: number | null;
  endEpoch?: number | null;
  druckCountPerson1: number;
  druckCountPerson2: number;
  druckMessungenPerson1: DruckInfo[];
  druckMessungenPerson2: DruckInfo[];
}

interface Geraetetraeger {
  id: string;
  vorname: string;
  nachname: string;
  funkrufname?: string | null;
  aktiv: boolean;
}

interface TruppName {
  id: string;
  name: string;
  aktiv: boolean;
  orderIndex: number;
}

interface DruckInfo {
  druckBar: number;
  zeit: string;
}
