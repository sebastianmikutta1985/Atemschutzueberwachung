import { ThemeStore } from './theme.store';

describe('ThemeStore', () => {
  beforeEach(() => localStorage.clear());

  it('starts in light mode when nothing was chosen on this device', () => {
    expect(ThemeStore.load('abc123_user')).toBe('light');
    expect(ThemeStore.load(null)).toBe('light');
  });

  it('keeps a saved choice', () => {
    ThemeStore.save('dark', 'abc123_user');
    expect(ThemeStore.load('abc123_user')).toBe('dark');
    ThemeStore.save('light', 'abc123_user');
    expect(ThemeStore.load('abc123_user')).toBe('light');
  });
});
