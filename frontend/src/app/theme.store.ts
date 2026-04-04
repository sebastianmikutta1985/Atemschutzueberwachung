export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'crewtrace_theme';

const hash = (input: string): string => {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
};

export const ThemeStore = {
  keyFromCredentials(orgCode: string, pin: string): string {
    return `${orgCode.toLowerCase()}_${hash(pin)}`;
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
