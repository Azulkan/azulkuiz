'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { GameManager } = require('./game-manager');

const PORT = process.env.PORT || 3000;
const QUESTIONS_PATH = path.join(__dirname, 'questions.json');
const DIST_PATH = path.join(__dirname, 'client', 'dist', 'client', 'browser');
const IMAGES_PATH = path.join(__dirname, 'public', 'images');

// Load questions at startup
const questionsConfig = require(QUESTIONS_PATH);
if (!questionsConfig.questions?.length) {
  console.error('questions.json must contain at least one question');
  process.exit(1);
}
questionsConfig.questions.forEach((q, i) => {
  if (!q.text && !q.image) {
    console.error(`Question ${i} has neither text nor image`);
    process.exit(1);
  }
});

const gameManager = new GameManager(
  questionsConfig.questions,
  questionsConfig.defaultTimeLimit ?? 20
);

const app = express();
app.use(express.json());

// Static: question images
app.use('/images', express.static(IMAGES_PATH));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Create room
app.post('/api/rooms', (_req, res) => {
  const room = gameManager.createRoom();
  res.json(room);
});

// Check room exists
app.get('/api/rooms/:token', (req, res) => {
  const exists = gameManager.rooms.has(req.params.token.toUpperCase());
  if (!exists) return res.status(404).json({ error: 'Room not found' });
  res.json({ exists: true });
});

// Serve Angular dist static assets
const fs = require('fs');
const DIST_INDEX = path.join(DIST_PATH, 'index.html');
const distBuilt = fs.existsSync(DIST_INDEX);
if (distBuilt) {
  app.use(express.static(DIST_PATH));
}

// SPA fallback — must be registered last, after all API routes.
// Using app.use() (not app.get('*')) so Express 5 wildcard changes don't apply.
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/images') || req.path === '/health') {
    return next(); // let these fall through to Express's built-in 404
  }
  if (distBuilt) {
    res.sendFile(DIST_INDEX);
  } else {
    res.status(503).send('Angular app not built yet. Run: cd client && ng build');
  }
});

// HTTP + WebSocket server on the same port
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    gameManager.handleMessage(ws, msg);
  });
  ws.on('close', () => gameManager.handleDisconnect(ws));
  ws.on('error', () => ws.terminate());
});

httpServer.listen(PORT, () => {
  console.log(`Azulkuiz server listening on http://localhost:${PORT}`);
  console.log(`Loaded ${questionsConfig.questions.length} questions`);
});
