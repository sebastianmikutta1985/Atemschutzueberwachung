import { ThemeStore } from './theme.store';

export type AuthRole = 'admin' | 'user';

// Nur Anzeige-Informationen. Der Login-Token liegt als httpOnly-Cookie beim Browser und ist fuer
// JavaScript bewusst nicht erreichbar.
export type AuthState = {
  role: AuthRole;
  orgName: string;
  orgCode: string;
  themeKey?: string;
};

const AUTH_KEY = 'ats_auth';

export const AuthStore = {
  load(): AuthState | null {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) {
      return null;
    }
    try {
      const state = JSON.parse(raw) as AuthState & { token?: string };
      if (state.token !== undefined) {
        // Aeltere Versionen speicherten den Token im localStorage – entfernen. Die Session endet dann beim
        // naechsten Aufruf (401), danach meldet man sich einmal neu an und erhaelt das Cookie.
        delete state.token;
        this.save(state);
      }
      const themeKey = ThemeStore.keyFromOrgRole(state.orgCode, state.role);
      if (state.themeKey !== themeKey) {
        // Alter Schluessel enthielt einen Hash der PIN – ersetzen, Einstellung uebernehmen.
        ThemeStore.renameKey(state.themeKey, themeKey);
        state.themeKey = themeKey;
        this.save(state);
      }
      return state;
    } catch {
      return null;
    }
  },

  save(state: AuthState): void {
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
  },

  clear(): void {
    localStorage.removeItem(AUTH_KEY);
  },

  isSignedIn(): boolean {
    return this.load() !== null;
  },

  role(): AuthRole | null {
    return this.load()?.role ?? null;
  },

  themeKey(): string | null {
    return this.load()?.themeKey ?? null;
  }
};
