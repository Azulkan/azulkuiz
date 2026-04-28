import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { GameStateService } from '@services/game-state.service';
import { WebSocketService } from '@services/websocket.service';
import { WsMessage } from '@models/game.models';

@Component({
  selector: 'app-home',
  imports: [FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly gameState = inject(GameStateService);
  private readonly ws = inject(WebSocketService);

  readonly mode = signal<'join' | 'create'>('join');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  joinToken = '';
  joinUsername = '';
  createUsername = '';

  switchMode(m: 'join' | 'create'): void {
    this.mode.set(m);
    this.error.set(null);
  }

  joinRoom(): void {
    const token = this.joinToken.trim().toUpperCase();
    const username = this.joinUsername.trim();
    if (!token || token.length !== 6) { this.error.set('Enter a valid 6-character room code'); return; }
    if (!username) { this.error.set('Enter your username'); return; }

    this.loading.set(true);
    this.error.set(null);

    this.http.get(`/api/rooms/${token}`).subscribe({
      next: () => this._connectAsPlayer(token, username),
      error: () => { this.error.set('Room not found'); this.loading.set(false); },
    });
  }

  createRoom(): void {
    const username = this.createUsername.trim();
    if (!username) { this.error.set('Enter your username'); return; }

    this.loading.set(true);
    this.error.set(null);

    this.http.post<{ token: string; adminSecret: string }>('/api/rooms', {}).subscribe({
      next: ({ token, adminSecret }) => {
        this.gameState.adminSecret.set(adminSecret);
        this._connectAsAdmin(token, username, adminSecret);
      },
      error: () => { this.error.set('Could not create room'); this.loading.set(false); },
    });
  }

  private _connectAsPlayer(token: string, username: string): void {
    this.ws.connect();
    // Wait for ROOM_JOINED
    const sub = this.ws.messages$.subscribe((msg: WsMessage) => {
      if (msg.type === 'ROOM_JOINED') {
        sub.unsubscribe();
        this.gameState.initSession(
          token,
          msg['playerId'] as string,
          false,
          (msg['players'] as []) ?? [],
          'WAITING',
          msg['questionCount'] as number
        );
        this.loading.set(false);
        this.router.navigate(['/game', token]);
      } else if (msg.type === 'ERROR') {
        sub.unsubscribe();
        this.error.set(msg['message'] as string);
        this.loading.set(false);
        this.ws.disconnect();
      }
    });
    this.ws.joinRoom(token, username);
  }

  private _connectAsAdmin(token: string, username: string, adminSecret: string): void {
    this.ws.connect();
    const sub = this.ws.messages$.subscribe((msg: WsMessage) => {
      if (msg.type === 'ROOM_JOINED') {
        sub.unsubscribe();
        this.gameState.initSession(
          token,
          'admin',
          true,
          (msg['players'] as []) ?? [],
          'WAITING',
          msg['questionCount'] as number
        );
        this.loading.set(false);
        this.router.navigate(['/game', token]);
      } else if (msg.type === 'ERROR') {
        sub.unsubscribe();
        this.error.set(msg['message'] as string);
        this.loading.set(false);
        this.ws.disconnect();
      }
    });
    this.ws.joinRoom(token, username, adminSecret);
  }
}
