import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';
import { ClockService } from './clock.service';
import { SessionService } from './session.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const clock = inject(ClockService);
  const requestStart = Date.now();
  const syncClock = tap((event: HttpEvent<unknown>) => {
    if (event instanceof HttpResponse) {
      clock.sync(event.headers.get('Date'), requestStart, Date.now());
    }
  });

  if (req.headers.has('Authorization')) {
    return next(req).pipe(syncClock);
  }
  const token = AuthStore.token();
  if (!token) {
    return next(req).pipe(syncClock);
  }
  const session = inject(SessionService);
  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  ).pipe(
    syncClock,
    catchError((err: unknown) => {
      // Session abgelaufen, widerrufen (z. B. PIN geaendert) oder Organisation gesperrt: zurueck zum Login.
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.endsWith('/auth/logout')) {
        session.endLocalSession();
      }
      return throwError(() => err);
    })
  );
};
