import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private connection: signalR.HubConnection | null = null;
  private listeners: Array<(type: string) => void> = [];
  private statusListeners: Array<(status: 'connected' | 'connecting' | 'disconnected') => void> = [];
  private baseUrl = environment.apiBaseUrl.replace(/\/api\/?$/, '');

  // Wiederholt den Verbindungsaufbau unbegrenzt (2 s, 4 s, ... max. 30 s). Die SignalR-Voreinstellung gibt nach
  // vier Versuchen (~42 s) auf – nach einem laengeren Funkloch kaemen dann nie wieder Live-Updates an.
  private static readonly retryPolicy: signalR.IRetryPolicy = {
    nextRetryDelayInMilliseconds: (ctx) => Math.min(30000, 2000 * (ctx.previousRetryCount + 1))
  };
  private wanted = false;
  private currentStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  private retryTimer?: number;
  private retryCount = 0;

  start(): void {
    if (!AuthStore.isSignedIn()) {
      return;
    }
    this.wanted = true;
    if (this.connection) {
      return;
    }
    // Anmeldung ueber das Session-Cookie (kein Token in der URL); negotiate ist ein POST und braucht den CSRF-Header.
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${this.baseUrl}/hubs/updates`, {
        withCredentials: true,
        headers: { 'X-Requested-With': 'CrewTrace' }
      })
      .withAutomaticReconnect(RealtimeService.retryPolicy)
      .build();
    this.connection = connection;

    connection.onreconnecting(() => {
      this.notifyStatus('connecting');
    });
    connection.onreconnected(() => {
      this.notifyStatus('connected');
    });
    connection.onclose(() => {
      this.notifyStatus('disconnected');
      // Geschlossen, obwohl weiter gewuenscht (z. B. Server neu gestartet): neu aufbauen.
      if (this.connection === connection) {
        this.connection = null;
        this.scheduleRestart();
      }
    });

    connection.on('update', (type: string) => {
      this.listeners.forEach((fn) => fn(type));
    });

    connection
      .start()
      .then(() => {
        this.retryCount = 0;
        this.notifyStatus('connected');
      })
      .catch(() => {
        this.notifyStatus('disconnected');
        // Erster Verbindungsaufbau fehlgeschlagen (z. B. kein Netz beim Laden): spaeter erneut versuchen.
        if (this.connection === connection) {
          this.connection = null;
          this.scheduleRestart();
        }
      });
  }

  stop(): void {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    this.retryCount = 0;
    this.currentStatus = 'disconnected';
    if (!this.connection) {
      return;
    }
    const current = this.connection;
    this.connection = null;
    current.stop().catch(() => {
      // ignore
    });
  }

  private scheduleRestart(): void {
    if (!this.wanted) {
      return;
    }
    window.clearTimeout(this.retryTimer);
    const delay = Math.min(30000, 2000 * (this.retryCount + 1));
    this.retryCount += 1;
    this.retryTimer = window.setTimeout(() => {
      if (this.wanted) {
        this.start();
      }
    }, delay);
  }

  get status(): 'connected' | 'connecting' | 'disconnected' {
    return this.currentStatus;
  }

  private notifyStatus(status: 'connected' | 'connecting' | 'disconnected'): void {
    this.currentStatus = status;
    this.statusListeners.forEach((fn) => fn(status));
  }

  onUpdate(fn: (type: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  onStatus(fn: (status: 'connected' | 'connecting' | 'disconnected') => void): () => void {
    this.statusListeners.push(fn);
    return () => {
      this.statusListeners = this.statusListeners.filter((f) => f !== fn);
    };
  }
}
