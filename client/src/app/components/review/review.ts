import { Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '@services/game-state.service';
import { WebSocketService } from '@services/websocket.service';
import { ReviewAnswer } from '@models/game.models';

@Component({
  selector: 'app-review',
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class Review {
  readonly gameState = inject(GameStateService);
  private readonly ws = inject(WebSocketService);

  readonly activeQIndex = signal(0);

  readonly activeQuestion = computed(() => {
    const qs = this.gameState.allQuestions();
    return qs[this.activeQIndex()] ?? null;
  });

  readonly activeAnswers = computed(() => {
    const all = this.gameState.allAnswers();
    return all[this.activeQIndex()] ?? [];
  });

  readonly sortedPlayers = computed(() => {
    return [...this.gameState.players()].sort((a, b) => a.username.localeCompare(b.username));
  });

  selectQuestion(index: number): void {
    this.activeQIndex.set(index);
  }

  markAnswer(answer: ReviewAnswer, valid: boolean): void {
    if (!this.gameState.isAdmin()) return;
    const token = this.gameState.token()!;
    const secret = this.gameState.adminSecret()!;
    this.ws.markAnswer(token, secret, answer.playerId, this.activeQIndex(), valid);
  }

  endReview(): void {
    const token = this.gameState.token()!;
    const secret = this.gameState.adminSecret()!;
    this.ws.endReview(token, secret);
  }
}
