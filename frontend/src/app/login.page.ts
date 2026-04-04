import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { ThemeStore } from './theme.store';

@Component({
  selector: 'app-login-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.page.html'
})
export class LoginPage {
  private readonly baseUrl = environment.apiBaseUrl;
  orgaCode = '';
  pin = '';
  remember = false;
  error = '';
  loading = false;

  constructor(private http: HttpClient, private router: Router, private title: Title) {}

  ngOnInit(): void {
    this.title.setTitle('CrewTrace - Anmeldung');
    const saved = localStorage.getItem('ats_login');
    if (saved) {
      try {
        const data = JSON.parse(saved) as { orgaCode?: string; pin?: string; remember?: boolean };
        this.orgaCode = data.orgaCode ?? '';
        this.pin = data.pin ?? '';
        this.remember = Boolean(data.remember);
      } catch {
        // ignore
      }
    }
  }

  login(): void {
    this.error = '';
    const code = this.orgaCode.trim();
    const pin = this.pin.trim();
    if (!code || !pin) {
      this.error = 'Bitte Organisationscode und PIN eingeben.';
      return;
    }
    this.loading = true;
    this.http
      .post<{ token: string; role: 'admin' | 'user'; orgName: string; orgCode: string }>(
        `${this.baseUrl}/auth/login`,
        { orgaCode: code, pin }
      )
      .subscribe({
        next: (res) => {
          if (this.remember) {
            localStorage.setItem(
              'ats_login',
              JSON.stringify({ orgaCode: code, pin, remember: true })
            );
          } else {
            localStorage.removeItem('ats_login');
          }
          const themeKey = ThemeStore.keyFromCredentials(code, pin);
          AuthStore.save({
            token: res.token,
            role: res.role,
            orgName: res.orgName,
            orgCode: res.orgCode,
            themeKey
          });
          const mode = ThemeStore.load(themeKey);
          ThemeStore.apply(mode);
          this.router.navigateByUrl('/');
        },
        error: () => {
          this.error = 'Login fehlgeschlagen. Code oder PIN falsch.';
          this.loading = false;
        }
      });
  }
}
