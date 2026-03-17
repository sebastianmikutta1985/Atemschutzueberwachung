import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

export const adminGuard: CanActivateFn = () => {
  const role = AuthStore.role();
  if (role === 'admin') {
    return true;
  }
  return inject(Router).createUrlTree(['/']);
};
