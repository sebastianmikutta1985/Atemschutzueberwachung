import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';
import { MonitoringService } from './monitoring.service';
import { RealtimeService } from './realtime.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly realtime = inject(RealtimeService);
  private readonly monitoring = inject(MonitoringService);

  // Beendet die Session auch am Server. Lokal wird immer abgemeldet, selbst wenn der Server nicht erreichbar ist.
  logout(): void {
    if (AuthStore.isSignedIn()) {
      this.http.post(`${environment.apiBaseUrl}/auth/logout`, {}).subscribe({ error: () => undefined });
    }
    this.endLocalSession();
  }

  // Fuer abgelaufene oder widerrufene Sessions (401): der Server kennt sie ohnehin nicht mehr.
  endLocalSession(): void {
    this.monitoring.stop();
    AuthStore.clear();
    this.realtime.stop();
    if (!this.router.url.startsWith('/login')) {
      this.router.navigateByUrl('/login');
    }
  }
}
