import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthStore } from './auth.store';
import { ThemeStore } from './theme.store';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  encapsulation: ViewEncapsulation.None
})
export class App implements OnInit {
  private readonly idleTimeoutMs = 2 * 60 * 60 * 1000;
  private readonly idleWarningMs = 2 * 60 * 1000;
  private readonly idleKey = 'airguard_last_active';
  private idleTimer?: number;
  private idleWarningTimer?: number;
  private idleCheck?: number;
  idleWarningOpen = false;

  constructor(private router: Router) {}

  ngOnInit(): void {
    const themeKey = AuthStore.themeKey();
    const mode = ThemeStore.load(themeKey);
    ThemeStore.apply(mode);
    this.markActivity();
    this.resetIdleTimer();
    this.startIdleCheck();
  }

  ngOnDestroy(): void {
    if (this.idleTimer) {
      window.clearTimeout(this.idleTimer);
    }
    if (this.idleWarningTimer) {
      window.clearTimeout(this.idleWarningTimer);
    }
    if (this.idleCheck) {
      window.clearInterval(this.idleCheck);
    }
  }

  @HostListener('document:mousemove')
  @HostListener('document:keydown')
  @HostListener('document:click')
  @HostListener('document:touchstart')
  @HostListener('document:scroll')
  onUserActivity(): void {
    this.markActivity();
    this.resetIdleTimer();
  }

  private markActivity(): void {
    localStorage.setItem(this.idleKey, Date.now().toString());
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      window.clearTimeout(this.idleTimer);
    }
    if (this.idleWarningTimer) {
      window.clearTimeout(this.idleWarningTimer);
    }
    this.idleWarningOpen = false;
    this.idleWarningTimer = window.setTimeout(
      () => this.showIdleWarning(),
      this.idleTimeoutMs - this.idleWarningMs
    );
    this.idleTimer = window.setTimeout(() => this.handleIdleTimeout(), this.idleTimeoutMs);
  }

  private startIdleCheck(): void {
    this.idleCheck = window.setInterval(() => {
      const raw = localStorage.getItem(this.idleKey);
      const last = raw ? Number(raw) : 0;
      if (last && Date.now() - last > this.idleTimeoutMs) {
        this.handleIdleTimeout();
      }
    }, 60000);
  }

  private showIdleWarning(): void {
    if (!AuthStore.load()) {
      return;
    }
    this.idleWarningOpen = true;
  }

  stayLoggedIn(): void {
    this.markActivity();
    this.resetIdleTimer();
  }

  logoutNow(): void {
    this.handleIdleTimeout();
  }

  private handleIdleTimeout(): void {
    if (!AuthStore.load()) {
      return;
    }
    this.idleWarningOpen = false;
    AuthStore.clear();
    this.router.navigateByUrl('/login');
  }
}
