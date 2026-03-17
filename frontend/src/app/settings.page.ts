import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Geraetetraeger, TruppName } from './models';

@Component({
  selector: 'app-settings-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './settings.page.html'
})
export class SettingsPage implements OnInit {
  private readonly baseUrl = 'http://localhost:5000/api';

  geraetetraeger: Geraetetraeger[] = [];
  truppnamen: TruppName[] = [];

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

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadGeraetetraeger();
    this.loadTruppnamen();
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
