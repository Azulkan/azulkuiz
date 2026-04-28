import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { WsMessage } from '@models/game.models';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws: WebSocket | null = null;
  private readonly messageSubject = new Subject<WsMessage>();

  readonly messages$ = this.messageSubject.asObservable();

  connect(): void {
    if (this.ws) this.disconnect();
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as WsMessage;
      this.messageSubject.next(msg);
    };
    this.ws.onerror = () => this.messageSubject.error(new Error('WebSocket error'));
    this.ws.onclose = () => {};
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.ws?.addEventListener('open', () => this.ws?.send(JSON.stringify(msg)), { once: true });
    }
  }

  joinRoom(token: string, username: string, adminSecret?: string): void {
    this.send({ type: 'JOIN_ROOM', token, username, adminSecret });
  }

  startGame(token: string, adminSecret: string): void {
    this.send({ type: 'START_GAME', token, adminSecret });
  }

  submitAnswer(token: string, questionIndex: number, answer: string): void {
    this.send({ type: 'SUBMIT_ANSWER', token, questionIndex, answer });
  }

  nextQuestion(token: string, adminSecret: string): void {
    this.send({ type: 'NEXT_QUESTION', token, adminSecret });
  }

  markAnswer(token: string, adminSecret: string, playerId: string, questionIndex: number, valid: boolean): void {
    this.send({ type: 'MARK_ANSWER', token, adminSecret, playerId, questionIndex, valid });
  }

  endReview(token: string, adminSecret: string): void {
    this.send({ type: 'END_REVIEW', token, adminSecret });
  }

  ping(): void {
    this.send({ type: 'PING' });
  }
}
