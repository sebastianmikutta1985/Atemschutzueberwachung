import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, ElementRef, OnInit, signal, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { environment } from '../environments/environment';
import { SystemStore } from './system.store';
import { TranslationService } from './translation.service';
import { ButtonComponent } from './ui/button.component';
import { DialogComponent } from './ui/dialog.component';
import { IconComponent } from './ui/icon.component';
import { LangSwitchComponent } from './ui/lang-switch.component';
import { PageComponent } from './ui/page.component';
import { PanelComponent } from './ui/panel.component';
import { TranslatePipe } from './ui/translate.pipe';

const MIN_PIN_LENGTH = 6;

type Org = {
  id: string;
  name: string;
  code: string;
  status: string;
};

type PinReset = { org: Org; role: 'admin' | 'user'; pin: string; error: string };

@Component({
  selector: 'app-manufacturer-page',
  imports: [FormsModule, ButtonComponent, DialogComponent, IconComponent, LangSwitchComponent, PageComponent, PanelComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer.page.html',
  styleUrl: './admin-list.css'
})
export class ManufacturerPage implements OnInit {
  private readonly baseUrl = environment.apiBaseUrl;

  systemSecret = '';
  // Die Session selbst liegt als httpOnly-Cookie beim Browser; hier nur, ob die Oberflaeche angemeldet ist.
  readonly signedIn = signal(SystemStore.isSignedIn());
  readonly error = signal('');

  readonly orgs = signal<Org[]>([]);
  readonly pinReset = signal<PinReset | null>(null);
  readonly blockConfirm = signal<Org | null>(null);
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
    if (this.signedIn()) {
      this.loadOrgs();
    }
  }

  loginSystem(): void {
    this.error.set('');
    const secret = this.systemSecret.trim();
    if (!secret) {
      this.error.set(this.i18n.t('manufacturer.loginSecretRequired'));
      return;
    }
    this.http.post<{ expiresAt: string }>(`${this.baseUrl}/system/login`, { secret }).subscribe({
      next: (res) => {
        this.systemSecret = '';
        this.signedIn.set(true);
        SystemStore.save({ expiresAt: Date.parse(res.expiresAt) });
        this.loadOrgs();
      },
      error: (err) => {
        this.error.set(
          err?.status === 429 ? this.i18n.t('login.errorTooManyAttempts') : this.i18n.t('manufacturer.loginFailed')
        );
      }
    });
  }

  logoutSystem(): void {
    // Session (und Cookie) auch am Server beenden; lokal wird in jedem Fall abgemeldet.
    this.http.post(`${this.baseUrl}/system/logout`, {}).subscribe({ error: () => undefined });
    SystemStore.clear();
    this.signedIn.set(false);
    this.orgs.set([]);
  }

  loadOrgs(): void {
    if (!this.signedIn()) {
      return;
    }
    this.http.get<Org[]>(`${this.baseUrl}/system/orgs`).subscribe({
      next: (list) => {
        this.orgs.set(list);
      },
      error: () => {
        this.error.set(this.i18n.t('manufacturer.loadFailed'));
      }
    });
  }

  createOrg(): void {
    if (!this.signedIn()) {
      return;
    }
    const name = this.orgForm.name.trim();
    const adminPin = this.orgForm.adminPin.trim();
    const userPin = this.orgForm.userPin.trim();
    if (!name || !adminPin || !userPin) {
      this.error.set(this.i18n.t('manufacturer.requiredFields'));
      return;
    }
    if (adminPin.length < MIN_PIN_LENGTH || userPin.length < MIN_PIN_LENGTH || adminPin === userPin) {
      this.error.set(this.i18n.t('manufacturer.pinTooShort'));
      return;
    }
    this.error.set('');
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
          this.orgForm = { name: '', adminPin: '', userPin: '', status: 'aktiv' };
          this.orgs.set([...this.orgs(), org]);
        },
        error: (err) => {
          this.error.set(this.apiError(err, 'manufacturer.createFailed'));
        }
      });
  }

  private apiError(err: { status?: number; error?: { error?: string } } | null, fallbackKey: string): string {
    if (err?.status === 401) {
      // Session abgelaufen: nur lokal abmelden, der Server kennt sie nicht mehr.
      SystemStore.clear();
      this.signedIn.set(false);
      this.orgs.set([]);
    }
    return err?.error?.error ?? this.i18n.t(fallbackKey);
  }

  // Sperren sofort wirksam: alle Sessions der Organisation enden. Daher erst nachfragen.
  toggleStatus(org: Org): void {
    if (org.status === 'aktiv') {
      this.blockConfirm.set(org);
      return;
    }
    this.updateStatus(org, 'aktiv');
  }

  confirmBlock(): void {
    const org = this.blockConfirm();
    this.blockConfirm.set(null);
    if (org) {
      this.updateStatus(org, 'gesperrt');
    }
  }

  private updateStatus(org: Org, status: 'aktiv' | 'gesperrt'): void {
    if (!this.signedIn()) {
      return;
    }
    this.error.set('');
    this.http
      .put<Org>(
        `${this.baseUrl}/system/orgs/${org.id}`,
        { status }
      )
      .subscribe({
        next: () => this.loadOrgs(),
        error: (err) => this.error.set(this.apiError(err, 'manufacturer.actionFailed'))
      });
  }

  // Eigener Dialog statt window.prompt: PIN-Eingabe verdeckt und mit Pruefung im Dialog.
  openPinReset(org: Org, role: 'admin' | 'user'): void {
    this.pinReset.set({ org, role, pin: '', error: '' });
    window.setTimeout(() => this.pinResetInput?.nativeElement.focus(), 0);
  }

  private setPinResetError(error: string): void {
    const current = this.pinReset();
    if (current) {
      this.pinReset.set({ ...current, error });
    }
  }

  submitPinReset(): void {
    const reset = this.pinReset();
    if (!reset || !this.signedIn()) {
      return;
    }
    const pin = reset.pin.trim();
    if (pin.length < MIN_PIN_LENGTH) {
      this.setPinResetError(this.i18n.t('manufacturer.pinTooShort'));
      return;
    }
    const payload = reset.role === 'admin' ? { adminPin: pin } : { userPin: pin };
    this.http
      .put<Org>(`${this.baseUrl}/system/orgs/${reset.org.id}`, payload)
      .subscribe({
        next: () => {
          this.pinReset.set(null);
          this.loadOrgs();
        },
        error: (err) => this.setPinResetError(this.apiError(err, 'manufacturer.actionFailed'))
      });
  }
}
