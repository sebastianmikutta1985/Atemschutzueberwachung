import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';
import { ClockService } from './clock.service';
import { SessionService } from './session.service';

// Die Anmeldung laeuft ueber ein httpOnly-Cookie, das der Browser selbst mitschickt. Der Header
// X-Requested-With kennzeichnet Anfragen der App; ohne ihn lehnt das Backend aendernde Anfragen ab (CSRF-Schutz).
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const clock = inject(ClockService);
  const session = inject(SessionService);
  const requestStart = Date.now();
  // Hersteller-Portal nutzt einen eigenen System-Token im Authorization-Header.
  const isSystemRequest = req.headers.has('Authorization');

  return next(req.clone({ setHeaders: { 'X-Requested-With': 'CrewTrace' } })).pipe(
    tap((event: HttpEvent<unknown>) => {
      if (event instanceof HttpResponse) {
        clock.sync(event.headers.get('Date'), requestStart, Date.now());
      }
    }),
    catchError((err: unknown) => {
      // Session abgelaufen, widerrufen (z. B. PIN geaendert) oder Organisation gesperrt: zurueck zum Login.
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !isSystemRequest &&
        AuthStore.isSignedIn() &&
        !req.url.endsWith('/auth/login') &&
        !req.url.endsWith('/auth/logout')
      ) {
        session.endLocalSession();
      }
      return throwError(() => err);
    })
  );
};
