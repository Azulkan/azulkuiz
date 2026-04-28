export type GamePhase = 'WAITING' | 'QUESTION' | 'LOCKED' | 'REVIEW' | 'LEADERBOARD';

export interface Player {
  playerId: string;
  username: string;
  connected: boolean;
}

export interface QuestionPayload {
  index: number;
  text: string | null;
  image: string | null;
  timeLimit: number;
}

export interface ReviewAnswer {
  playerId: string;
  username: string;
  answer: string;
  valid: boolean | null;
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  score: number;
  rank: number;
}

export type ScoreMap = Record<string, number | undefined>;

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}
