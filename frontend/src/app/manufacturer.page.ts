import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { SystemStore } from './system.store';

type Org = {
  id: string;
  name: string;
  code: string;
  status: string;
};

@Component({
  selector: 'app-manufacturer-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './manufacturer.page.html'
})
export class ManufacturerPage implements OnInit {
  private readonly baseUrl = environment.apiBaseUrl;

  systemSecret = '';
  systemToken = SystemStore.token();
  error = '';

  orgs: Org[] = [];
  orgForm = {
    name: '',
    adminPin: '',
    userPin: '',
    status: 'aktiv'
  };

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (this.systemToken) {
      this.loadOrgs();
    }
  }

  loginSystem(): void {
    this.error = '';
    const secret = this.systemSecret.trim();
    if (!secret) {
      this.error = 'Bitte Hersteller-Secret eingeben.';
      return;
    }
    this.http.post<{ token: string }>(`${this.baseUrl}/system/login`, { secret }).subscribe({
      next: (res) => {
        this.systemToken = res.token;
        SystemStore.save({ token: res.token });
        this.loadOrgs();
      },
      error: () => {
        this.error = 'Login fehlgeschlagen.';
      }
    });
  }

  logoutSystem(): void {
    SystemStore.clear();
    this.systemToken = null;
    this.orgs = [];
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({
      Authorization: `System ${this.systemToken}`
    });
  }

  loadOrgs(): void {
    if (!this.systemToken) {
      return;
    }
    this.http.get<Org[]>(`${this.baseUrl}/system/orgs`, { headers: this.authHeaders() }).subscribe({
      next: (list) => {
        this.orgs = list;
      },
      error: () => {
        this.error = 'Konnte Organisationen nicht laden.';
      }
    });
  }

  createOrg(): void {
    if (!this.systemToken) {
      return;
    }
    const name = this.orgForm.name.trim();
    const adminPin = this.orgForm.adminPin.trim();
    const userPin = this.orgForm.userPin.trim();
    if (!name || !adminPin || !userPin) {
      this.error = 'Name, Admin-PIN und Benutzer-PIN sind Pflicht.';
      return;
    }
    this.http
      .post<Org>(
        `${this.baseUrl}/system/orgs`,
        {
          name,
          adminPin,
          userPin,
          status: this.orgForm.status
        },
        { headers: this.authHeaders() }
      )
      .subscribe({
        next: (org) => {
          this.orgs = [...this.orgs, org];
          this.orgForm = { name: '', adminPin: '', userPin: '', status: 'aktiv' };
        },
        error: () => {
          this.error = 'Organisation konnte nicht angelegt werden.';
        }
      });
  }

  toggleStatus(org: Org): void {
    if (!this.systemToken) {
      return;
    }
    const status = org.status === 'aktiv' ? 'gesperrt' : 'aktiv';
    this.http
      .put<Org>(
        `${this.baseUrl}/system/orgs/${org.id}`,
        { status },
        { headers: this.authHeaders() }
      )
      .subscribe(() => this.loadOrgs());
  }

  resetPin(org: Org, role: 'admin' | 'user'): void {
    if (!this.systemToken) {
      return;
    }
    const pin = window.prompt(`${role.toUpperCase()}-PIN neu setzen:`);
    if (!pin) {
      return;
    }
    const payload = role === 'admin' ? { adminPin: pin } : { userPin: pin };
    this.http
      .put<Org>(`${this.baseUrl}/system/orgs/${org.id}`, payload, { headers: this.authHeaders() })
      .subscribe(() => this.loadOrgs());
  }
}
