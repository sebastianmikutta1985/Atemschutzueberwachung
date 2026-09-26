import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = () => {
  if (AuthStore.isSignedIn()) {
    return true;
  }
  return inject(Router).createUrlTree(['/login']);
};
