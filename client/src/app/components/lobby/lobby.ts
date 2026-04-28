import { Component, inject } from '@angular/core';
import { GameStateService } from '@services/game-state.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-lobby',
  templateUrl: './lobby.html',
  styleUrl: './lobby.scss',
})
export class Lobby {
  readonly gameState = inject(GameStateService);
  private readonly ws = inject(WebSocketService);

  copyToken(): void {
    const token = this.gameState.token();
    if (token) navigator.clipboard.writeText(token);
  }

  startGame(): void {
    const token = this.gameState.token();
    const secret = this.gameState.adminSecret();
    if (token && secret) this.ws.startGame(token, secret);
  }

  get canStart(): boolean {
    return this.gameState.players().length > 0;
  }
}
