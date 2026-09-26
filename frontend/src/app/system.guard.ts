import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SystemStore } from './system.store';

export const systemGuard: CanActivateFn = () => {
  if (SystemStore.isSignedIn()) {
    return true;
  }
  return inject(Router).createUrlTree(['/admin-login']);
};
