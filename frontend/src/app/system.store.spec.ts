import { SystemStore } from './system.store';

describe('SystemStore', () => {
  beforeEach(() => localStorage.clear());

  it('is signed in until the session expires', () => {
    SystemStore.save({ expiresAt: Date.now() + 60_000 });
    expect(SystemStore.isSignedIn()).toBe(true);

    SystemStore.save({ expiresAt: Date.now() - 1 });
    expect(SystemStore.isSignedIn()).toBe(false);
    expect(localStorage.getItem('ats_system')).toBeNull();
  });

  it('removes a manufacturer token stored by older versions', () => {
    localStorage.setItem('ats_system', JSON.stringify({ token: 'alter-system-token', expiresAt: Date.now() + 60_000 }));

    expect(SystemStore.isSignedIn()).toBe(false);
    expect(localStorage.getItem('ats_system')).toBeNull();
  });
});
