import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from './auth.store';
import { SessionService } from './session.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.headers.has('Authorization')) {
    return next(req);
  }
  const token = AuthStore.token();
  if (!token) {
    return next(req);
  }
  const session = inject(SessionService);
  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  ).pipe(
    catchError((err: unknown) => {
      // Session abgelaufen, widerrufen (z. B. PIN geaendert) oder Organisation gesperrt: zurueck zum Login.
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.endsWith('/auth/logout')) {
        session.endLocalSession();
      }
      return throwError(() => err);
    })
  );
};
