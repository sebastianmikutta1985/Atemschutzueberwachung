import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthStore } from './auth.store';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideRouter([])]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet without the idle warning', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
    expect(compiled.querySelector('.modal')).toBeNull();
  });
});

describe('AuthStore', () => {
  beforeEach(() => localStorage.clear());

  it('replaces a legacy PIN-derived theme key and keeps the theme preference', () => {
    localStorage.setItem('crewtrace_theme_abc123_1x2y3z', 'light');
    localStorage.setItem(
      'ats_auth',
      JSON.stringify({ role: 'user', orgName: 'FW', orgCode: 'ABC123', themeKey: 'abc123_1x2y3z' })
    );

    const state = AuthStore.load();

    expect(state?.themeKey).toBe('abc123_user');
    expect(localStorage.getItem('crewtrace_theme_abc123_user')).toBe('light');
    expect(localStorage.getItem('crewtrace_theme_abc123_1x2y3z')).toBeNull();
  });

  it('removes a login token stored by older versions', () => {
    localStorage.setItem(
      'ats_auth',
      JSON.stringify({ token: 'secret-token', role: 'admin', orgName: 'FW', orgCode: 'ABC123', themeKey: 'abc123_admin' })
    );

    const state = AuthStore.load();

    expect(state?.role).toBe('admin');
    expect(localStorage.getItem('ats_auth')).not.toContain('secret-token');
  });
});
