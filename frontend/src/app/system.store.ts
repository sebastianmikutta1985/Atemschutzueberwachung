// Nur der Ablaufzeitpunkt der Hersteller-Session. Der Token selbst liegt als httpOnly-Cookie (Path=/api/system)
// beim Browser und ist fuer JavaScript bewusst nicht erreichbar.
export type SystemState = {
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
      const state = JSON.parse(raw) as SystemState & { token?: string };
      if (state.token !== undefined) {
        // Aeltere Versionen speicherten den Token im localStorage – entfernen; danach einmal neu anmelden.
        this.clear();
        return null;
      }
      return state;
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

  isSignedIn(): boolean {
    const state = this.load();
    if (!state) {
      return false;
    }
    if (Date.now() > state.expiresAt) {
      this.clear();
      return false;
    }
    return true;
  }
};
