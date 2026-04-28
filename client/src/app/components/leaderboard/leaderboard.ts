import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GameStateService } from '@services/game-state.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-leaderboard',
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.scss',
})
export class Leaderboard {
  readonly gameState = inject(GameStateService);
  private readonly router = inject(Router);
  private readonly ws = inject(WebSocketService);

  readonly podium = [2, 1, 3]; // display order: 2nd, 1st, 3rd

  getPodiumEntry(rank: number) {
    return this.gameState.leaderboard().find((e) => e.rank === rank) ?? null;
  }

  readonly restEntries = () =>
    this.gameState.leaderboard().filter((e) => e.rank > 3);

  playAgain(): void {
    this.gameState.reset();
    this.router.navigate(['/']);
  }
}
