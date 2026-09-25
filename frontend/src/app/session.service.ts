import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { RealtimeService } from './realtime.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly realtime = inject(RealtimeService);

  // Beendet die Session auch am Server. Lokal wird immer abgemeldet, selbst wenn der Server nicht erreichbar ist.
  logout(): void {
    const token = AuthStore.token();
    if (token) {
      this.http.post(`${environment.apiBaseUrl}/auth/logout`, {}).subscribe({ error: () => undefined });
    }
    this.endLocalSession();
  }

  // Fuer abgelaufene oder widerrufene Sessions (401): der Server kennt sie ohnehin nicht mehr.
  endLocalSession(): void {
    AuthStore.clear();
    this.realtime.stop();
    if (!this.router.url.startsWith('/login')) {
      this.router.navigateByUrl('/login');
    }
  }
}
