import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { environment } from '../environments/environment';
import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private connection: signalR.HubConnection | null = null;
  private listeners: Array<(type: string) => void> = [];
  private baseUrl = environment.apiBaseUrl.replace(/\/api\/?$/, '');

  start(): void {
    if (this.connection) {
      return;
    }
    const auth = AuthStore.load();
    if (!auth?.token) {
      return;
    }
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${this.baseUrl}/hubs/updates`, {
        accessTokenFactory: () => auth.token
      })
      .withAutomaticReconnect()
      .build();

    this.connection.on('update', (type: string) => {
      this.listeners.forEach((fn) => fn(type));
    });

    this.connection.start().catch(() => {
      // ignore connection errors
    });
  }

  stop(): void {
    if (!this.connection) {
      return;
    }
    const current = this.connection;
    this.connection = null;
    current.stop().catch(() => {
      // ignore
    });
  }

  onUpdate(fn: (type: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }
}
