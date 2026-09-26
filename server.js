const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000, pingInterval: 25000 });
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'typing-battles.db');
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Set it in Render environment variables.');
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    elo INTEGER NOT NULL DEFAULT 1000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    winner_id INTEGER,
    loser_id INTEGER,
    winner_elo_before INTEGER,
    loser_elo_before INTEGER,
    winner_elo_after INTEGER,
    loser_elo_after INTEGER,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

const socketUsers = new Map();
const queue = [];
const matches = new Map();
const rooms = new Map();
const authAttempts = new Map();
const WORD_POOL = [
  'apple','planet','keyboard','velocity','sunlight','mountain','river','window','future','computer',
  'garden','orange','silver','rocket','coffee','forest','typing','battle','thunder','ocean','purple',
  'winter','summer','friend','coding','castle','dragon','music','puzzle','energy','signal','rapid',
  'precision','focus','challenge','victory','practice','rhythm','speed','bright','shadow','crystal',
  'engine','galaxy','simple','modern','creative','player','arena','champion','target','moment'
];

function userFromReq(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, username, elo FROM users WHERE id = ?').get(req.session.userId) || null;
}
function safeSettings(input = {}) {
  const mode = input.mode === 'time' ? 'time' : 'words';
  return {
    mode,
    words: Math.max(10, Math.min(200, Number(input.words) || 30)),
    time: Math.max(10, Math.min(300, Number(input.time) || 60)),
    punctuation: !!input.punctuation,
    capitals: !!input.capitals,
    numbers: !!input.numbers,
    mistakes: input.mistakes === 'unlimited' ? 'unlimited' : String(Math.max(1, Math.min(50, Number(input.mistakes) || 3)))
  };
}
function makeText(settings) {
  const targetWords = settings.mode === 'words' ? settings.words : Math.max(180, Math.ceil(settings.time * 2.5));
  const words = [];
  for (let i = 0; i < targetWords; i++) {
    let word = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)];
    if (settings.capitals && (i === 0 || Math.random() < 0.14)) word = word[0].toUpperCase() + word.slice(1);
    if (settings.numbers && i % 7 === 3) word += String(Math.floor(Math.random() * 90) + 10);
    if (settings.punctuation && Math.random() < 0.22) word += ['.', ',', '!', '?'][Math.floor(Math.random() * 4)];
    words.push(word);
  }
  return words.join(' ');
}
function eloRange(item) {
  return Math.min(500, 100 + Math.floor((Date.now() - item.at) / 30000) * 50);
}
function removeFromQueue(socketId) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].socketId === socketId) queue.splice(i, 1);
}
function publicRooms() {
  return [...rooms.values()]
    .filter(r => !r.private && !r.started)
    .map(r => ({ code: r.code, players: r.players.size, settings: r.settings }));
}
function emitRooms() { io.emit('roomList', publicRooms()); }
function joinSocketRoom(socketId, roomId) {
  const s = io.sockets.sockets.get(socketId);
  if (s) s.join(roomId);
}
function guestForSocket(socket) {
  return { userId: null, username: `Guest-${socket.id.slice(0, 4).toUpperCase()}`, elo: 1000 };
}
function getSocketUser(socket) {
  if (!socketUsers.has(socket.id)) socketUsers.set(socket.id, guestForSocket(socket));
  return socketUsers.get(socket.id);
}

function finishMatch(match, winnerSocketId, reason = 'finish', valid = true) {
  if (!match || match.finished) return;
  match.finished = true;
  clearTimeout(match.timer);
  const winner = winnerSocketId ? match.players[winnerSocketId] : null;
  const loserSocketId = winnerSocketId ? (winnerSocketId === match.a ? match.b : match.a) : null;
  const loser = loserSocketId ? match.players[loserSocketId] : null;
  const winnerUser = winnerSocketId ? socketUsers.get(winnerSocketId) : null;
  const loserUser = loserSocketId ? socketUsers.get(loserSocketId) : null;

  let eloChange = null;
  if (match.mode === 'ranked' && valid && winnerUser?.userId && loserUser?.userId) {
    const wu = db.prepare('SELECT id, username, elo FROM users WHERE id=?').get(winnerUser.userId);
    const lu = db.prepare('SELECT id, username, elo FROM users WHERE id=?').get(loserUser.userId);
    if (wu && lu) {
      const expected = 1 / (1 + Math.pow(10, (lu.elo - wu.elo) / 400));
      const delta = Math.max(10, Math.round(32 * (1 - expected)));
      const winnerAfter = wu.elo + delta;
      const loserAfter = Math.max(100, lu.elo - delta);
      db.prepare('UPDATE users SET elo=? WHERE id=?').run(winnerAfter, wu.id);
      db.prepare('UPDATE users SET elo=? WHERE id=?').run(loserAfter, lu.id);
      db.prepare(`INSERT INTO matches(mode,winner_id,loser_id,winner_elo_before,loser_elo_before,winner_elo_after,loser_elo_after,reason)
                   VALUES(?,?,?,?,?,?,?,?)`).run('ranked', wu.id, lu.id, wu.elo, lu.elo, winnerAfter, loserAfter, reason);
      winnerUser.elo = winnerAfter;
      loserUser.elo = loserAfter;
      eloChange = { winner: winnerAfter - wu.elo, loser: loserAfter - lu.elo, winnerElo: winnerAfter, loserElo: loserAfter };
    }
  }

  const payload = { winner: winnerSocketId, reason, valid, eloChange, scores: Object.fromEntries(Object.entries(match.players).map(([sid, p]) => [sid, { progress: p.progress, mistakes: p.mistakes }])) };
  io.to(match.roomId).emit('battleEnd', payload);
  setTimeout(() => matches.delete(match.id), 10000);
}

function startQuickMatch(a, b) {
  const id = crypto.randomUUID();
  const settings = safeSettings({ ...a.settings, mode: a.mode === 'ranked' ? 'words' : a.settings.mode });
  const text = makeText(settings);
  const roomId = `match:${id}`;
  const match = {
    id, roomId, a: a.socketId, b: b.socketId, mode: a.mode, settings, text, started: false, finished: false,
    players: {
      [a.socketId]: { progress: 0, mistakes: 0, lastIndex: 0, lastAt: 0 },
      [b.socketId]: { progress: 0, mistakes: 0, lastIndex: 0, lastAt: 0 }
    }
  };
  matches.set(id, match);
  joinSocketRoom(a.socketId, roomId); joinSocketRoom(b.socketId, roomId);
  socketUsers.get(a.socketId).matchId = id; socketUsers.get(b.socketId).matchId = id;
  io.to(a.socketId).emit('matchFound', { matchId: id, opponent: { username: b.username, elo: b.elo }, text, settings, startsIn: 3 });
  io.to(b.socketId).emit('matchFound', { matchId: id, opponent: { username: a.username, elo: a.elo }, text, settings, startsIn: 3 });
  setTimeout(() => {
    if (match.finished) return;
    match.started = true; match.startAt = Date.now();
    io.to(roomId).emit('battleStart', { startAt: match.startAt });
    if (settings.mode === 'time') match.timer = setTimeout(() => finishByProgress(match, 'time'), settings.time * 1000 + 100);
  }, 3200);
}
function finishByProgress(match, reason) {
  if (match.finished) return;
  const entries = Object.entries(match.players);
  const [firstId, first] = entries[0];
  const [secondId, second] = entries[1];
  if (first.progress === second.progress) return finishMatch(match, null, 'time-draw', false);
  finishMatch(match, first.progress > second.progress ? firstId : secondId, reason, true);
}
function validateProgress(match, socket, payload) {
  const p = match.players[socket.id];
  if (!p || !match.started || match.finished) return false;
  const value = typeof payload.value === 'string' ? payload.value : '';
  if (value.length > match.text.length || value.length < p.progress) return false;
  if (value !== match.text.slice(0, value.length)) return false;
  const now = Date.now();
  if (value.length > p.progress) {
    const added = value.length - p.progress;
    const elapsed = Math.max(1, now - p.lastAt);
    if (p.lastAt && added > 12 && elapsed < 100) return false;
    p.lastIndex = p.progress; p.progress = value.length; p.lastAt = now;
  }
  const reportedMistakes = Math.max(0, Number(payload.mistakes) || 0);
  p.mistakes = Math.max(p.mistakes, Math.min(999, reportedMistakes));
  io.to(match.roomId).emit('opponentProgress', { socketId: socket.id, index: p.progress, mistakes: p.mistakes });
  const limit = match.settings.mistakes;
  if (limit !== 'unlimited' && p.mistakes > Number(limit)) { finishMatch(match, socket.id === match.a ? match.b : match.a, 'mistakes', true); return true; }
  if (match.settings.mode === 'words' && p.progress >= match.text.length) finishMatch(match, socket.id, 'finish', true);
  return true;
}

app.get('/health', (req, res) => res.status(200).json({ ok: true, uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() }));
app.get('/api/me', (req, res) => res.json({ user: userFromReq(req) }));
app.post('/api/signup', (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim(); password = String(password || '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username) || password.length < 8) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers, or underscores and password must be at least 8 characters.' });
  try {
    const hash = bcrypt.hashSync(password, 12);
    const r = db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run(username, hash);
    req.session.userId = r.lastInsertRowid;
    res.json({ user: userFromReq(req) });
  } catch { res.status(409).json({ error: 'Username already exists.' }); }
});
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const recent = (authAttempts.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 15) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  recent.push(now); authAttempts.set(ip, recent);
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Invalid username or password.' });
  req.session.userId = u.id;
  res.json({ user: userFromReq(req) });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

io.on('connection', socket => {
  socketUsers.set(socket.id, guestForSocket(socket));
  socket.emit('guestReady', socketUsers.get(socket.id));
  socket.on('identify', () => {
    const u = userFromReq(socket.request);
    if (u) { socketUsers.set(socket.id, { userId: u.id, username: u.username, elo: u.elo }); socket.emit('identified', u); }
  });
  socket.on('queueJoin', ({ mode='casual', settings={} } = {}) => {
    const u = getSocketUser(socket);
    if (mode === 'ranked' && !u.userId) return socket.emit('errorMsg', 'Ranked requires an account.');
    removeFromQueue(socket.id);
    const normalized = safeSettings(settings);
    const item = { socketId: socket.id, userId: u.userId, username: u.username, elo: u.elo || 1000, mode: mode === 'ranked' ? 'ranked' : 'casual', settings: normalized, at: Date.now() };
    let opponentIndex = -1;
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (q.socketId !== item.socketId && q.mode === item.mode && Math.abs(q.elo - item.elo) <= eloRange(item)) { opponentIndex = i; break; }
    }
    if (opponentIndex >= 0) { const opp = queue.splice(opponentIndex, 1)[0]; startQuickMatch(item, opp); }
    else queue.push(item);
  });
  socket.on('queueLeave', () => removeFromQueue(socket.id));
  socket.on('progress', payload => {
    const id = String(payload?.matchId || ''); const match = matches.get(id);
    if (!match || !match.players[socket.id]) return;
    validateProgress(match, socket, payload || {});
  });

  socket.on('createRoom', ({ settings={}, privateRoom=false } = {}) => {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const normalized = safeSettings(settings);
    const room = { code, host: socket.id, private: !!privateRoom, settings: normalized, text: makeText(normalized), players: new Set([socket.id]), started: false, finished: false };
    rooms.set(code, room); socket.join(`room:${code}`);
    socket.emit('roomCreated', { code, private: room.private, invite: `/room/${code}` });
    emitRooms();
  });
  socket.on('roomList', () => socket.emit('roomList', publicRooms()));
  socket.on('joinRoom', ({ code } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || room.started) return socket.emit('errorMsg', 'Room not found or already started.');
    if (room.players.size >= 2) return socket.emit('errorMsg', 'That room is full.');
    room.players.add(socket.id); socket.join(`room:${room.code}`);
    io.to(`room:${room.code}`).emit('roomState', { code: room.code, players: room.players.size, settings: room.settings, host: room.host });
    emitRooms();
  });
  socket.on('startRoom', ({ code } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || room.host !== socket.id || room.players.size < 2 || room.started) return;
    room.started = true; room.startAt = Date.now() + 3000; room.text = makeText(room.settings);
    io.to(`room:${room.code}`).emit('roomBattle', { code: room.code, text: room.text, settings: room.settings, startAt: room.startAt });
    setTimeout(() => { if (!room.finished) io.to(`room:${room.code}`).emit('battleStart', { startAt: room.startAt }); }, Math.max(0, room.startAt - Date.now()));
    if (room.settings.mode === 'time') room.timer = setTimeout(() => finishRoomByProgress(room), room.settings.time * 1000 + 100);
    emitRooms();
  });
  socket.on('roomProgress', ({ code, value='', mistakes=0 } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || !room.started || room.finished || !room.players.has(socket.id)) return;
    room.progress ||= {}; room.progress[socket.id] ||= { progress: 0, mistakes: 0, lastAt: 0 };
    const p = room.progress[socket.id];
    if (typeof value !== 'string' || value.length < p.progress || value.length > room.text.length || value !== room.text.slice(0, value.length)) return;
    const now = Date.now(); if (p.lastAt && value.length - p.progress > 12 && now - p.lastAt < 100) return;
    p.progress = value.length; p.mistakes = Math.max(p.mistakes, Number(mistakes) || 0); p.lastAt = now;
    io.to(`room:${room.code}`).emit('roomOpponentProgress', { socketId: socket.id, index: p.progress, mistakes: p.mistakes });
    if (room.settings.mistakes !== 'unlimited' && p.mistakes > Number(room.settings.mistakes)) finishRoom(room, [...room.players].find(id => id !== socket.id), 'mistakes');
    else if (room.settings.mode === 'words' && p.progress >= room.text.length) finishRoom(room, socket.id, 'finish');
  });
  socket.on('disconnect', () => {
    removeFromQueue(socket.id); socketUsers.delete(socket.id);
    for (const [code, room] of rooms) {
      if (!room.players.has(socket.id)) continue;
      room.players.delete(socket.id);
      if (room.host === socket.id) room.host = room.players.values().next().value || null;
      if (!room.players.size) { clearTimeout(room.timer); rooms.delete(code); }
      else io.to(`room:${code}`).emit('roomState', { code, players: room.players.size, settings: room.settings, host: room.host });
    }
    emitRooms();
  });
});

function finishRoom(room, winnerSocket, reason) {
  if (room.finished) return; room.finished = true; clearTimeout(room.timer);
  io.to(`room:${room.code}`).emit('battleEnd', { winner: winnerSocket || null, reason, valid: true });
  setTimeout(() => rooms.delete(room.code), 10000);
}
function finishRoomByProgress(room) {
  if (room.finished) return;
  const ids = [...room.players]; const a = room.progress?.[ids[0]]?.progress || 0; const b = room.progress?.[ids[1]]?.progress || 0;
  finishRoom(room, a === b ? null : (a > b ? ids[0] : ids[1]), a === b ? 'time-draw' : 'time');
}

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/health' || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.on('error', err => { console.error('Server error:', err); });
server.listen(PORT, '0.0.0.0', () => console.log(`TypeRush running on port ${PORT}`));
