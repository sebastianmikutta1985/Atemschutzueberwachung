import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = () => {
  const token = AuthStore.token();
  if (token) {
    return true;
  }
  return inject(Router).createUrlTree(['/login']);
};
