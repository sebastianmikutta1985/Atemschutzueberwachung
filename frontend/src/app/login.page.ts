import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';

@Component({
  selector: 'app-login-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.page.html'
})
export class LoginPage {
  private readonly baseUrl = environment.apiBaseUrl;
  orgaCode = '';
  pin = '';
  error = '';
  loading = false;

  constructor(private http: HttpClient, private router: Router) {}

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
          AuthStore.save({
            token: res.token,
            role: res.role,
            orgName: res.orgName,
            orgCode: res.orgCode
          });
          this.router.navigateByUrl('/');
        },
        error: () => {
          this.error = 'Login fehlgeschlagen. Code oder PIN falsch.';
          this.loading = false;
        }
      });
  }
}
