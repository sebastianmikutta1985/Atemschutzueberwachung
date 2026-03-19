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
      return JSON.parse(raw) as AuthState;
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
