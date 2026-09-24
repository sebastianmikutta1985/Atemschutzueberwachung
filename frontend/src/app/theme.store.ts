export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'crewtrace_theme';

// Nur fuer die einmalige Uebernahme alter Einstellungen; frueher wurde der Schluessel aus der PIN gebildet.
const legacyPinHash = (input: string): string => {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
};

export const ThemeStore = {
  keyFromOrgRole(orgCode: string, role: string): string {
    return `${orgCode.toLowerCase()}_${role}`;
  },

  migrateLegacyKey(orgCode: string, pin: string, newThemeKey: string): void {
    this.renameKey(`${orgCode.toLowerCase()}_${legacyPinHash(pin)}`, newThemeKey);
  },

  renameKey(oldThemeKey: string | null | undefined, newThemeKey: string): void {
    if (!oldThemeKey || oldThemeKey === newThemeKey) {
      return;
    }
    const oldStorageKey = this.keyFor(oldThemeKey);
    const value = localStorage.getItem(oldStorageKey);
    if (value === null) {
      return;
    }
    if (localStorage.getItem(this.keyFor(newThemeKey)) === null) {
      localStorage.setItem(this.keyFor(newThemeKey), value);
    }
    localStorage.removeItem(oldStorageKey);
  },

  keyFor(themeKey?: string | null): string {
    return themeKey ? `${THEME_KEY}_${themeKey}` : `${THEME_KEY}_guest`;
  },

  load(themeKey?: string | null): ThemeMode {
    const raw = localStorage.getItem(this.keyFor(themeKey));
    if (!raw) {
      return 'dark';
    }
    return raw === 'light' ? 'light' : 'dark';
  },

  save(mode: ThemeMode, themeKey?: string | null): void {
    localStorage.setItem(this.keyFor(themeKey), mode);
  },

  apply(mode: ThemeMode): void {
    document.documentElement.setAttribute('data-theme', mode);
  }
};
