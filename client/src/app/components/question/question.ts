import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GameStateService } from '@services/game-state.service';
import { WebSocketService } from '@services/websocket.service';

@Component({
  selector: 'app-question',
  imports: [FormsModule],
  templateUrl: './question.html',
  styleUrl: './question.scss',
})
export class Question {
  readonly locked = input<boolean>(false);

  readonly gameState = inject(GameStateService);
  private readonly ws = inject(WebSocketService);

  answer = '';

  readonly playerCount = computed(() => this.gameState.players().length);

  readonly timerColor = computed(() => {
    const pct = this.gameState.timerPct();
    if (pct > 50) return 'var(--accent-ok)';
    if (pct > 25) return 'var(--accent-warn)';
    return 'var(--accent-err)';
  });

  submitAnswer(): void {
    const a = this.answer.trim();
    if (!a || this.gameState.hasAnswered() || this.locked()) return;
    const token = this.gameState.token()!;
    const qIndex = this.gameState.currentQuestion()!.index;
    this.ws.submitAnswer(token, qIndex, a);
    this.gameState.hasAnswered.set(true);
  }

  nextQuestion(): void {
    const token = this.gameState.token()!;
    const secret = this.gameState.adminSecret()!;
    this.ws.nextQuestion(token, secret);
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.submitAnswer();
    }
  }
}
