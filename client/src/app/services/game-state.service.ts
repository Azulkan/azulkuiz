import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  GamePhase,
  LeaderboardEntry,
  Player,
  QuestionPayload,
  ReviewAnswer,
  ScoreMap,
  WsMessage,
} from '@models/game.models';
import { WebSocketService } from './websocket.service';

@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly ws = inject(WebSocketService);
  private sub: Subscription | null = null;

  // Identity
  readonly playerId = signal<string | null>(null);
  readonly isAdmin = signal<boolean>(false);
  readonly adminSecret = signal<string | null>(null);
  readonly token = signal<string | null>(null);

  // Game state
  readonly phase = signal<GamePhase>('WAITING');
  readonly players = signal<Player[]>([]);
  readonly questionCount = signal<number>(0);
  readonly currentQuestion = signal<QuestionPayload | null>(null);
  readonly timerRemaining = signal<number>(0);
  readonly hasAnswered = signal<boolean>(false);
  readonly answeredCount = signal<number>(0);
  readonly allQuestions = signal<QuestionPayload[]>([]);
  readonly allAnswers = signal<Record<number, ReviewAnswer[]>>({});
  readonly scores = signal<ScoreMap>({});
  readonly leaderboard = signal<LeaderboardEntry[]>([]);

  // Computed helpers
  readonly imageUrl = computed(() => {
    const q = this.currentQuestion();
    return q?.image ? `/images/${q.image}` : null;
  });

  readonly timerPct = computed(() => {
    const q = this.currentQuestion();
    if (!q) return 0;
    return (this.timerRemaining() / q.timeLimit) * 100;
  });

  readonly myScore = computed(() => this.scores()[this.playerId() ?? ''] ?? 0);

  initSession(token: string, playerId: string, isAdmin: boolean, players: Player[], phase: GamePhase, questionCount: number): void {
    this.token.set(token);
    this.playerId.set(playerId);
    this.isAdmin.set(isAdmin);
    this.players.set(players);
    this.phase.set(phase);
    this.questionCount.set(questionCount);
    this.sub?.unsubscribe();
    this.sub = this.ws.messages$.subscribe({ next: (msg) => this.handleMessage(msg) });
  }

  reset(): void {
    this.sub?.unsubscribe();
    this.sub = null;
    this.ws.disconnect();
    this.playerId.set(null);
    this.isAdmin.set(false);
    this.adminSecret.set(null);
    this.token.set(null);
    this.phase.set('WAITING');
    this.players.set([]);
    this.questionCount.set(0);
    this.currentQuestion.set(null);
    this.timerRemaining.set(0);
    this.hasAnswered.set(false);
    this.answeredCount.set(0);
    this.allQuestions.set([]);
    this.allAnswers.set({});
    this.scores.set({});
    this.leaderboard.set([]);
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.type) {
      case 'PLAYER_LIST':
        this.players.set(msg['players'] as Player[]);
        break;

      case 'GAME_STARTED':
        this.questionCount.set(msg['questionCount'] as number);
        this.answeredCount.set(0);
        this.setQuestion(msg['currentQuestion'] as QuestionPayload);
        this.phase.set('QUESTION');
        break;

      case 'QUESTION':
        this.answeredCount.set(0);
        this.setQuestion(msg['question'] as QuestionPayload);
        this.phase.set('QUESTION');
        break;

      case 'TIMER_UPDATE':
        this.timerRemaining.set(msg['remaining'] as number);
        break;

      case 'ANSWERS_LOCKED':
        this.phase.set('LOCKED');
        break;

      case 'ANSWER_RECEIVED':
        this.answeredCount.update((n) => n + 1);
        break;

      case 'REVIEW_START':
        this.allQuestions.set(msg['questions'] as QuestionPayload[]);
        this.allAnswers.set(msg['allAnswers'] as Record<number, ReviewAnswer[]>);
        this.phase.set('REVIEW');
        break;

      case 'ANSWER_MARKED': {
        const { playerId, questionIndex, valid, scores } = msg as {
          type: string;
          playerId: string;
          questionIndex: number;
          valid: boolean;
          scores: ScoreMap;
        };
        this.scores.set(scores);
        this.allAnswers.update((prev) => {
          const updated = { ...prev };
          if (updated[questionIndex]) {
            updated[questionIndex] = updated[questionIndex].map((a) =>
              a.playerId === playerId ? { ...a, valid } : a
            );
          }
          return updated;
        });
        break;
      }

      case 'LEADERBOARD':
        this.leaderboard.set(msg['scores'] as LeaderboardEntry[]);
        this.allAnswers.set(msg['allAnswers'] as Record<number, ReviewAnswer[]>);
        this.phase.set('LEADERBOARD');
        break;

      case 'CATCH_UP': {
        const phase = msg['phase'] as GamePhase;
        if (phase === 'QUESTION' || phase === 'LOCKED') {
          this.setQuestion(msg['question'] as QuestionPayload);
          this.timerRemaining.set(msg['timerRemaining'] as number);
          if (msg['hasAnswered']) this.hasAnswered.set(true);
        } else if (phase === 'REVIEW') {
          this.allQuestions.set(msg['questions'] as QuestionPayload[]);
          this.allAnswers.set(msg['allAnswers'] as Record<number, ReviewAnswer[]>);
          this.scores.set(msg['scores'] as ScoreMap);
        } else if (phase === 'LEADERBOARD') {
          this.leaderboard.set(msg['leaderboard'] as LeaderboardEntry[]);
          this.allAnswers.set(msg['allAnswers'] as Record<number, ReviewAnswer[]>);
        }
        // Set phase last so the component switches only once all data is ready
        this.phase.set(phase);
        break;
      }
    }
  }

  private setQuestion(q: QuestionPayload): void {
    this.currentQuestion.set(q);
    this.timerRemaining.set(q.timeLimit);
    this.hasAnswered.set(false);
  }
}
