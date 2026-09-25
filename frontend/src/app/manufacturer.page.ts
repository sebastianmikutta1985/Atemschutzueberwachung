import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, effect, OnInit } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { SystemStore } from './system.store';
import { TranslationService } from './translation.service';

const MIN_PIN_LENGTH = 6;

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

  constructor(
    private http: HttpClient,
    private title: Title,
    public i18n: TranslationService
  ) {
    effect(() => {
      this.i18n.lang();
      this.title.setTitle(`${this.i18n.t('common.appName')} - ${this.i18n.t('manufacturer.title')}`);
    });
  }

  ngOnInit(): void {
    if (this.systemToken) {
      this.loadOrgs();
    }
  }

  loginSystem(): void {
    this.error = '';
    const secret = this.systemSecret.trim();
    if (!secret) {
      this.error = this.i18n.t('manufacturer.loginSecretRequired');
      return;
    }
    this.http.post<{ token: string }>(`${this.baseUrl}/system/login`, { secret }).subscribe({
      next: (res) => {
        this.systemToken = res.token;
        const expiresAt = Date.now() + 30 * 60 * 1000;
        SystemStore.save({ token: res.token, expiresAt });
        this.loadOrgs();
      },
      error: (err) => {
        this.error =
          err?.status === 429 ? this.i18n.t('login.errorTooManyAttempts') : this.i18n.t('manufacturer.loginFailed');
      }
    });
  }

  logoutSystem(): void {
    if (this.systemToken) {
      // Session auch am Server beenden; lokal wird in jedem Fall abgemeldet.
      this.http
        .post(`${this.baseUrl}/system/logout`, {}, { headers: this.authHeaders() })
        .subscribe({ error: () => undefined });
    }
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
        this.error = this.i18n.t('manufacturer.loadFailed');
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
      this.error = this.i18n.t('manufacturer.requiredFields');
      return;
    }
    if (adminPin.length < MIN_PIN_LENGTH || userPin.length < MIN_PIN_LENGTH || adminPin === userPin) {
      this.error = this.i18n.t('manufacturer.pinTooShort');
      return;
    }
    this.error = '';
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
        error: (err) => {
          this.error = this.apiError(err, 'manufacturer.createFailed');
        }
      });
  }

  private apiError(err: { status?: number; error?: { error?: string } } | null, fallbackKey: string): string {
    if (err?.status === 401) {
      this.logoutSystem();
    }
    return err?.error?.error ?? this.i18n.t(fallbackKey);
  }

  toggleStatus(org: Org): void {
    if (!this.systemToken) {
      return;
    }
    const status = org.status === 'aktiv' ? 'gesperrt' : 'aktiv';
    this.error = '';
    this.http
      .put<Org>(
        `${this.baseUrl}/system/orgs/${org.id}`,
        { status },
        { headers: this.authHeaders() }
      )
      .subscribe({
        next: () => this.loadOrgs(),
        error: (err) => (this.error = this.apiError(err, 'manufacturer.actionFailed'))
      });
  }

  resetPin(org: Org, role: 'admin' | 'user'): void {
    if (!this.systemToken) {
      return;
    }
    const pin = window.prompt(
      this.i18n.t('manufacturer.resetPinPrompt', { role: role.toUpperCase() })
    );
    if (!pin) {
      return;
    }
    if (pin.trim().length < MIN_PIN_LENGTH) {
      this.error = this.i18n.t('manufacturer.pinTooShort');
      return;
    }
    this.error = '';
    const payload = role === 'admin' ? { adminPin: pin.trim() } : { userPin: pin.trim() };
    this.http
      .put<Org>(`${this.baseUrl}/system/orgs/${org.id}`, payload, { headers: this.authHeaders() })
      .subscribe({
        next: () => this.loadOrgs(),
        error: (err) => (this.error = this.apiError(err, 'manufacturer.actionFailed'))
      });
  }
}
