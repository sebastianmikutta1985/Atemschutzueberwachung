export type SystemState = {
  token: string;
  expiresAt: number;
};

const SYSTEM_KEY = 'ats_system';

export const SystemStore = {
  load(): SystemState | null {
    const raw = localStorage.getItem(SYSTEM_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as SystemState;
    } catch {
      return null;
    }
  },

  save(state: SystemState): void {
    localStorage.setItem(SYSTEM_KEY, JSON.stringify(state));
  },

  clear(): void {
    localStorage.removeItem(SYSTEM_KEY);
  },

  token(): string | null {
    const state = this.load();
    if (!state) {
      return null;
    }
    if (state.expiresAt && Date.now() > state.expiresAt) {
      this.clear();
      return null;
    }
    return state.token;
  }
};
