import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { Geraetetraeger, OrgSettings, TruppName } from './models';

@Component({
  selector: 'app-settings-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings.page.html'
})
export class SettingsPage implements OnInit {
  private readonly baseUrl = environment.apiBaseUrl;

  geraetetraeger: Geraetetraeger[] = [];
  truppnamen: TruppName[] = [];
  orgSettings: OrgSettings | null = null;
  dragIndex: number | null = null;

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

  editingTruppNameId: string | null = null;
  editingTruppNameValue = '';

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    this.loadGeraetetraeger();
    this.loadTruppnamen();
    this.loadOrgSettings();
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
