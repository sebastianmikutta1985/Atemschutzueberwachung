import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, effect, ElementRef, OnInit, ViewChild } from '@angular/core';
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
  // Die Session selbst liegt als httpOnly-Cookie beim Browser; hier nur, ob die Oberflaeche angemeldet ist.
  signedIn = SystemStore.isSignedIn();
  error = '';

  orgs: Org[] = [];
  pinReset: { org: Org; role: 'admin' | 'user'; pin: string; error: string } | null = null;
  blockConfirm: Org | null = null;
  @ViewChild('pinResetInput') pinResetInput?: ElementRef<HTMLInputElement>;
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
    if (this.signedIn) {
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
    this.http.post<{ expiresAt: string }>(`${this.baseUrl}/system/login`, { secret }).subscribe({
      next: (res) => {
        this.systemSecret = '';
        this.signedIn = true;
        SystemStore.save({ expiresAt: Date.parse(res.expiresAt) });
        this.loadOrgs();
      },
      error: (err) => {
        this.error =
          err?.status === 429 ? this.i18n.t('login.errorTooManyAttempts') : this.i18n.t('manufacturer.loginFailed');
      }
    });
  }

  logoutSystem(): void {
    // Session (und Cookie) auch am Server beenden; lokal wird in jedem Fall abgemeldet.
    this.http.post(`${this.baseUrl}/system/logout`, {}).subscribe({ error: () => undefined });
    SystemStore.clear();
    this.signedIn = false;
    this.orgs = [];
  }

  loadOrgs(): void {
    if (!this.signedIn) {
      return;
    }
    this.http.get<Org[]>(`${this.baseUrl}/system/orgs`).subscribe({
      next: (list) => {
        this.orgs = list;
      },
      error: () => {
        this.error = this.i18n.t('manufacturer.loadFailed');
      }
    });
  }

  createOrg(): void {
    if (!this.signedIn) {
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
        }
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
      // Session abgelaufen: nur lokal abmelden, der Server kennt sie nicht mehr.
      SystemStore.clear();
      this.signedIn = false;
      this.orgs = [];
    }
    return err?.error?.error ?? this.i18n.t(fallbackKey);
  }

  // Sperren sofort wirksam: alle Sessions der Organisation enden. Daher erst nachfragen.
  toggleStatus(org: Org): void {
    if (org.status === 'aktiv') {
      this.blockConfirm = org;
      return;
    }
    this.updateStatus(org, 'aktiv');
  }

  confirmBlock(): void {
    const org = this.blockConfirm;
    this.blockConfirm = null;
    if (org) {
      this.updateStatus(org, 'gesperrt');
    }
  }

  private updateStatus(org: Org, status: 'aktiv' | 'gesperrt'): void {
    if (!this.signedIn) {
      return;
    }
    this.error = '';
    this.http
      .put<Org>(
        `${this.baseUrl}/system/orgs/${org.id}`,
        { status }
      )
      .subscribe({
        next: () => this.loadOrgs(),
        error: (err) => (this.error = this.apiError(err, 'manufacturer.actionFailed'))
      });
  }

  // Eigener Dialog statt window.prompt: PIN-Eingabe verdeckt und mit Pruefung im Dialog.
  openPinReset(org: Org, role: 'admin' | 'user'): void {
    this.pinReset = { org, role, pin: '', error: '' };
    window.setTimeout(() => this.pinResetInput?.nativeElement.focus(), 0);
  }

  submitPinReset(): void {
    const reset = this.pinReset;
    if (!reset || !this.signedIn) {
      return;
    }
    const pin = reset.pin.trim();
    if (pin.length < MIN_PIN_LENGTH) {
      reset.error = this.i18n.t('manufacturer.pinTooShort');
      return;
    }
    const payload = reset.role === 'admin' ? { adminPin: pin } : { userPin: pin };
    this.http
      .put<Org>(`${this.baseUrl}/system/orgs/${reset.org.id}`, payload)
      .subscribe({
        next: () => {
          this.pinReset = null;
          this.loadOrgs();
        },
        error: (err) => (reset.error = this.apiError(err, 'manufacturer.actionFailed'))
      });
  }
}
