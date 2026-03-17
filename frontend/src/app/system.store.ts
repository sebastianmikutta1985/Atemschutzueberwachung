export type SystemState = {
  token: string;
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
    return this.load()?.token ?? null;
  }
};
