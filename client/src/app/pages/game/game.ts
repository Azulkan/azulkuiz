import { Component, OnInit, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { GameStateService } from '@services/game-state.service';
import { Lobby } from '@components/lobby/lobby';
import { Question } from '@components/question/question';
import { Review } from '@components/review/review';
import { Leaderboard } from '@components/leaderboard/leaderboard';

@Component({
  selector: 'app-game',
  imports: [Lobby, Question, Review, Leaderboard],
  templateUrl: './game.html',
  styleUrl: './game.scss',
})
export class Game implements OnInit {
  readonly token = input<string>('');
  readonly gameState = inject(GameStateService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    if (!this.gameState.token()) {
      this.router.navigate(['/']);
    }
  }
}
