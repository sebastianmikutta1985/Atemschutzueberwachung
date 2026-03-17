import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SystemStore } from './system.store';

export const systemGuard: CanActivateFn = () => {
  const token = SystemStore.token();
  if (token) {
    return true;
  }
  return inject(Router).createUrlTree(['/hersteller']);
};
