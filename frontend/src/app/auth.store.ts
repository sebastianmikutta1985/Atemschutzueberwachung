import { ThemeStore } from './theme.store';

export type AuthRole = 'admin' | 'user';

export type AuthState = {
  token: string;
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
      const state = JSON.parse(raw) as AuthState;
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

  token(): string | null {
    return this.load()?.token ?? null;
  },

  role(): AuthRole | null {
    return this.load()?.role ?? null;
  },

  themeKey(): string | null {
    return this.load()?.themeKey ?? null;
  }
};
