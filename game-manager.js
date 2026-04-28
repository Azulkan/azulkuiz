'use strict';

const { v4: uuidv4 } = require('uuid');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateToken() {
  let token = '';
  for (let i = 0; i < 6; i++) token += CHARS[Math.floor(Math.random() * CHARS.length)];
  return token;
}

function computeScore(receivedAt, questionStartedAt, timeLimitSeconds) {
  const elapsed = receivedAt - questionStartedAt;
  const timeLimitMs = timeLimitSeconds * 1000;
  return Math.round(200 + 800 * Math.max(0, 1 - elapsed / timeLimitMs));
}

class GameManager {
  constructor(questions, defaultTimeLimit) {
    this.questions = questions;
    this.defaultTimeLimit = defaultTimeLimit;
    this.rooms = new Map(); // token -> room
    this.wsToRoom = new Map(); // ws -> { token, playerId }
  }

  createRoom() {
    let token;
    do { token = generateToken(); } while (this.rooms.has(token));

    const adminSecret = uuidv4();
    const room = {
      token,
      adminSecret,
      adminWs: null,
      players: new Map(),
      phase: 'WAITING',
      currentQuestionIndex: -1,
      questionStartedAt: 0,
      questionStartTimes: new Map(), // qIdx -> Date.now() at question start
      answers: new Map(),
      timerHandle: null,
      questions: this.questions.map((q, i) => ({
        index: i,
        text: q.text ?? null,
        image: q.image ?? null,
        timeLimit: q.timeLimit ?? this.defaultTimeLimit,
      })),
    };
    this.rooms.set(token, room);
    return { token, adminSecret };
  }

  handleMessage(ws, msg) {
    const type = msg.type;
    try {
      switch (type) {
        case 'JOIN_ROOM':    return this._joinRoom(ws, msg);
        case 'START_GAME':   return this._startGame(ws, msg);
        case 'SUBMIT_ANSWER': return this._submitAnswer(ws, msg);
        case 'NEXT_QUESTION': return this._nextQuestion(ws, msg);
        case 'MARK_ANSWER':  return this._markAnswer(ws, msg);
        case 'END_REVIEW':   return this._endReview(ws, msg);
        case 'PING':         return this._unicast(ws, { type: 'PONG' });
        default:
          this._unicast(ws, { type: 'ERROR', code: 'UNKNOWN_TYPE', message: `Unknown message type: ${type}` });
      }
    } catch (err) {
      console.error('handleMessage error:', err);
      this._unicast(ws, { type: 'ERROR', code: 'INTERNAL', message: 'Internal server error' });
    }
  }

  handleDisconnect(ws) {
    const info = this.wsToRoom.get(ws);
    if (!info) return;
    this.wsToRoom.delete(ws);

    const room = this.rooms.get(info.token);
    if (!room) return;

    if (info.isAdmin) {
      room.adminWs = null;
      return;
    }

    const player = room.players.get(info.playerId);
    if (player) {
      player.connected = false;
      player.ws = null;
      this._broadcastPlayerList(room);
    }
  }

  // ── Private handlers ──────────────────────────────────────────────────────

  _joinRoom(ws, msg) {
    const { token, username, adminSecret } = msg;
    const room = this.rooms.get(token);
    if (!room) {
      return this._unicast(ws, { type: 'ERROR', code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    }

    const isAdmin = adminSecret === room.adminSecret;

    if (isAdmin) {
      room.adminWs = ws;
      this.wsToRoom.set(ws, { token, playerId: 'admin', isAdmin: true });
      this._unicast(ws, {
        type: 'ROOM_JOINED',
        token,
        playerId: 'admin',
        isAdmin: true,
        players: this._playerList(room),
        phase: room.phase,
        questionCount: room.questions.length,
      });
      return;
    }

    if (!username || username.trim().length === 0) {
      return this._unicast(ws, { type: 'ERROR', code: 'BAD_USERNAME', message: 'Username required' });
    }

    if (room.phase !== 'WAITING') {
      // Allow rejoin by matching username (case-insensitive)
      const normalised = username.trim().toLowerCase();
      const existing = [...room.players.entries()]
        .find(([, p]) => p.username.toLowerCase() === normalised);

      if (!existing) {
        return this._unicast(ws, { type: 'ERROR', code: 'GAME_STARTED', message: 'Game already in progress' });
      }

      const [playerId, player] = existing;
      player.ws = ws;
      player.connected = true;
      this.wsToRoom.set(ws, { token, playerId, isAdmin: false });

      this._unicast(ws, {
        type: 'ROOM_JOINED',
        token,
        playerId,
        isAdmin: false,
        players: this._playerList(room),
        phase: room.phase,
        questionCount: room.questions.length,
      });
      this._broadcastPlayerList(room);
      this._sendCatchUp(ws, room, playerId);
      return;
    }

    const playerId = uuidv4();
    room.players.set(playerId, { ws, username: username.trim(), connected: true });
    this.wsToRoom.set(ws, { token, playerId, isAdmin: false });

    this._unicast(ws, {
      type: 'ROOM_JOINED',
      token,
      playerId,
      isAdmin: false,
      players: this._playerList(room),
      phase: room.phase,
      questionCount: room.questions.length,
    });

    this._broadcastPlayerList(room);
  }

  _startGame(ws, msg) {
    const room = this._authAdmin(ws, msg);
    if (!room) return;

    if (room.phase !== 'WAITING') {
      return this._unicast(ws, { type: 'ERROR', code: 'WRONG_PHASE', message: 'Game already started' });
    }
    if (room.players.size === 0) {
      return this._unicast(ws, { type: 'ERROR', code: 'NO_PLAYERS', message: 'Need at least one player' });
    }

    this._beginQuestion(room, 0);
  }

  _submitAnswer(ws, msg) {
    const info = this.wsToRoom.get(ws);
    if (!info || info.isAdmin) return;

    const room = this.rooms.get(info.token);
    if (!room || room.phase !== 'QUESTION') {
      return this._unicast(ws, { type: 'ERROR', code: 'WRONG_PHASE', message: 'Not accepting answers' });
    }

    const { questionIndex, answer } = msg;
    if (questionIndex !== room.currentQuestionIndex) return;

    if (!room.answers.has(questionIndex)) room.answers.set(questionIndex, new Map());
    const qAnswers = room.answers.get(questionIndex);

    if (qAnswers.has(info.playerId)) return; // already answered

    if (!answer || answer.trim().length === 0) {
      return this._unicast(ws, { type: 'ERROR', code: 'EMPTY_ANSWER', message: 'Answer cannot be empty' });
    }

    qAnswers.set(info.playerId, {
      answer: answer.trim(),
      receivedAt: Date.now(),
      valid: null,
    });

    this._broadcast(room, { type: 'ANSWER_RECEIVED', playerId: info.playerId });
  }

  _nextQuestion(ws, msg) {
    const room = this._authAdmin(ws, msg);
    if (!room) return;

    if (room.phase !== 'LOCKED') {
      return this._unicast(ws, { type: 'ERROR', code: 'WRONG_PHASE', message: 'Not in LOCKED phase' });
    }

    const nextIndex = room.currentQuestionIndex + 1;

    if (nextIndex < room.questions.length) {
      this._beginQuestion(room, nextIndex);
    } else {
      this._beginReview(room);
    }
  }

  _markAnswer(ws, msg) {
    const room = this._authAdmin(ws, msg);
    if (!room) return;

    if (room.phase !== 'REVIEW') {
      return this._unicast(ws, { type: 'ERROR', code: 'WRONG_PHASE', message: 'Not in REVIEW phase' });
    }

    const { playerId, questionIndex, valid } = msg;
    const qAnswers = room.answers.get(questionIndex);
    if (!qAnswers || !qAnswers.has(playerId)) return;

    qAnswers.get(playerId).valid = valid;

    const scores = this._computeScores(room);
    this._broadcast(room, { type: 'ANSWER_MARKED', playerId, questionIndex, valid, scores });
  }

  _endReview(ws, msg) {
    const room = this._authAdmin(ws, msg);
    if (!room) return;

    if (room.phase !== 'REVIEW') {
      return this._unicast(ws, { type: 'ERROR', code: 'WRONG_PHASE', message: 'Not in REVIEW phase' });
    }

    room.phase = 'LEADERBOARD';

    const scores = this._computeScores(room);
    const entries = this._playerList(room)
      .map((p) => ({ playerId: p.playerId, username: p.username, score: scores[p.playerId] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    this._broadcast(room, {
      type: 'LEADERBOARD',
      scores: entries,
      allAnswers: this._serializeAllAnswers(room),
    });

    setTimeout(() => this.rooms.delete(room.token), 10 * 60 * 1000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _beginQuestion(room, index) {
    if (room.timerHandle) clearTimeout(room.timerHandle);

    room.phase = 'QUESTION';
    room.currentQuestionIndex = index;
    room.questionStartedAt = Date.now();
    room.questionStartTimes.set(index, room.questionStartedAt);

    const question = room.questions[index];
    const startedAt = room.questionStartedAt;

    const broadcastPayload = { type: 'QUESTION', questionIndex: index, question, startedAt };

    if (index === 0) {
      this._broadcast(room, {
        type: 'GAME_STARTED',
        questionCount: room.questions.length,
        currentQuestion: question,
        startedAt,
      });
    } else {
      this._broadcast(room, broadcastPayload);
    }

    // Server-side countdown + TIMER_UPDATE every second
    let remaining = question.timeLimit;
    const tick = () => {
      remaining--;
      this._broadcast(room, { type: 'TIMER_UPDATE', remaining });
      if (remaining <= 0) {
        this._lockQuestion(room);
      } else {
        room.timerHandle = setTimeout(tick, 1000);
      }
    };
    room.timerHandle = setTimeout(tick, 1000);
  }

  _lockQuestion(room) {
    room.phase = 'LOCKED';
    room.timerHandle = null;
    this._broadcast(room, { type: 'ANSWERS_LOCKED', questionIndex: room.currentQuestionIndex });
  }

  _beginReview(room) {
    room.phase = 'REVIEW';
    this._broadcast(room, {
      type: 'REVIEW_START',
      questions: room.questions,
      allAnswers: this._serializeAllAnswers(room),
    });
  }

  _serializeAllAnswers(room) {
    const result = {};
    for (const [qIdx, qAnswers] of room.answers.entries()) {
      result[qIdx] = [];
      for (const [playerId, data] of qAnswers.entries()) {
        const player = room.players.get(playerId);
        result[qIdx].push({
          playerId,
          username: player?.username ?? '?',
          answer: data.answer,
          valid: data.valid,
        });
      }
    }
    return result;
  }

  _computeScores(room) {
    const scores = {};
    for (const [playerId] of room.players.entries()) scores[playerId] = 0;

    for (const [qIdx, qAnswers] of room.answers.entries()) {
      const question = room.questions[qIdx];
      const startedAt = room.questionStartTimes.get(qIdx) ?? 0;
      for (const [playerId, data] of qAnswers.entries()) {
        if (data.valid === true) {
          scores[playerId] = (scores[playerId] ?? 0) + computeScore(
            data.receivedAt,
            startedAt,
            question.timeLimit
          );
        }
      }
    }
    return scores;
  }

  _authAdmin(ws, msg) {
    const info = this.wsToRoom.get(ws);
    if (!info) { this._unicast(ws, { type: 'ERROR', code: 'NOT_IN_ROOM', message: 'Not in a room' }); return null; }

    const room = this.rooms.get(info.token ?? msg.token);
    if (!room) { this._unicast(ws, { type: 'ERROR', code: 'ROOM_NOT_FOUND', message: 'Room not found' }); return null; }

    if (msg.adminSecret !== room.adminSecret) {
      this._unicast(ws, { type: 'ERROR', code: 'FORBIDDEN', message: 'Admin action forbidden' });
      return null;
    }
    return room;
  }

  _playerList(room) {
    return Array.from(room.players.entries()).map(([playerId, p]) => ({
      playerId,
      username: p.username,
      connected: p.connected,
    }));
  }

  _sendCatchUp(ws, room, playerId) {
    const q = room.questions[room.currentQuestionIndex];

    switch (room.phase) {
      case 'QUESTION': {
        const elapsed = Math.floor((Date.now() - room.questionStartedAt) / 1000);
        const remaining = Math.max(0, q.timeLimit - elapsed);
        const hasAnswered = room.answers.get(room.currentQuestionIndex)?.has(playerId) ?? false;
        this._unicast(ws, {
          type: 'CATCH_UP',
          phase: 'QUESTION',
          question: q,
          timerRemaining: remaining,
          hasAnswered,
        });
        break;
      }
      case 'LOCKED': {
        const hasAnswered = room.answers.get(room.currentQuestionIndex)?.has(playerId) ?? false;
        this._unicast(ws, {
          type: 'CATCH_UP',
          phase: 'LOCKED',
          question: q,
          timerRemaining: 0,
          hasAnswered,
        });
        break;
      }
      case 'REVIEW':
        this._unicast(ws, {
          type: 'CATCH_UP',
          phase: 'REVIEW',
          questions: room.questions,
          allAnswers: this._serializeAllAnswers(room),
          scores: this._computeScores(room),
        });
        break;
      case 'LEADERBOARD':
        this._unicast(ws, {
          type: 'CATCH_UP',
          phase: 'LEADERBOARD',
          leaderboard: this._computeLeaderboard(room),
          allAnswers: this._serializeAllAnswers(room),
        });
        break;
    }
  }

  _computeLeaderboard(room) {
    const scores = this._computeScores(room);
    return this._playerList(room)
      .map((p) => ({ playerId: p.playerId, username: p.username, score: scores[p.playerId] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }

  _broadcastPlayerList(room) {
    this._broadcast(room, { type: 'PLAYER_LIST', players: this._playerList(room) });
  }

  _broadcast(room, msg) {
    const data = JSON.stringify(msg);
    if (room.adminWs?.readyState === 1) room.adminWs.send(data);
    for (const [, player] of room.players.entries()) {
      if (player.ws?.readyState === 1) player.ws.send(data);
    }
  }

  _unicast(ws, msg) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  }
}

module.exports = { GameManager };
