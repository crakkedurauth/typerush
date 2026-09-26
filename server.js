```js
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 100000
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not configured.");
}

app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false
    })
  : null;

async function db(sql, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return pool.query(sql, params);
}

async function initializeDatabase() {
  if (!pool) {
    console.warn("Ranked accounts disabled: DATABASE_URL is missing.");
    return;
  }

  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(18) UNIQUE NOT NULL,
      email VARCHAR(254) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      elo INTEGER NOT NULL DEFAULT 1000,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    elo: user.elo,
    games: user.games,
    wins: user.wins
  };
}

function createToken(user) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign(
    { id: String(user.id) },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function getAuthUser(req) {
  const token = req.cookies?.typerush_token;

  if (!token || !JWT_SECRET) {
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function getUser(id) {
  if (!pool) return null;

  const result = await db(
    `
      SELECT
        id,
        username,
        email,
        password_hash,
        elo,
        games,
        wins
      FROM users
      WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

function validUsername(username) {
  return /^[A-Za-z0-9_ -]{3,18}$/.test(username);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  return typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 128;
}

/* =========================================================
   ACCOUNT API
========================================================= */

app.post("/api/auth/signup", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        error: "Ranked accounts are not configured yet."
      });
    }

    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!validUsername(username)) {
      return res.status(400).json({
        error:
          "Username must be 3–18 characters and may contain letters, numbers, spaces, hyphens, and underscores."
      });
    }

    if (!validEmail(email)) {
      return res.status(400).json({
        error: "Please enter a valid email address."
      });
    }

    if (!validPassword(password)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db(
      `
        INSERT INTO users (
          username,
          email,
          password_hash
        )
        VALUES ($1, $2, $3)
        RETURNING id, username, elo, games, wins
      `,
      [username, email, passwordHash]
    );

    const user = result.rows[0];

    res.cookie(
      "typerush_token",
      createToken(user),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000
      }
    );

    res.json({
      user: publicUser(user)
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "That username or email is already registered."
      });
    }

    console.error(error);

    res.status(500).json({
      error: "Could not create your account."
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    if (!pool) {
      return res.status(503).json({
        error: "Ranked accounts are not configured yet."
      });
    }

    const login = String(req.body.login || "").trim();
    const password = String(req.body.password || "");

    const result = await db(
      `
        SELECT
          id,
          username,
          email,
          password_hash,
          elo,
          games,
          wins
        FROM users
        WHERE LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($1)
      `,
      [login]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: "Incorrect username/email or password."
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Incorrect username/email or password."
      });
    }

    res.cookie(
      "typerush_token",
      createToken(user),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000
      }
    );

    res.json({
      user: publicUser(user)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not sign in."
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("typerush_token");
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  try {
    const auth = getAuthUser(req);

    if (!auth) {
      return res.json({
        user: null
      });
    }

    const user = await getUser(auth.id);

    res.json({
      user: user ? publicUser(user) : null
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Could not load account."
    });
  }
});

/* =========================================================
   GAME CONFIGURATION
========================================================= */

const WORDS = `
the of and a to in is you that it he was for on are as with his they
I at be this have from or one had by word but not what all were we
when your can said there use an each which she do how their if will
up other about out many then them these so some her would make like
him into time has look two more write go see number no way could
people my than first water been call who oil its now find long down
day did get come made may part over quick brown fox jumps lazy dog
typing battle speed focus race keyboard computer screen world light
dark green blue red home open close new old small large good great
right left high low fast slow every again because before after while
where why work play learn win challenge practice player room public
private
`.trim().split(/\s+/);

const rooms = new Map();
const casualQueue = [];
const rankedQueue = [];
const timers = new Map();

function cleanName(value) {
  const name = String(value || "Racer")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .trim()
    .slice(0, 18);

  return name || "Racer";
}

function normalizeSettings(settings = {}) {
  return {
    mode: settings.mode === "time" ? "time" : "words",

    words: Math.min(
      100,
      Math.max(10, Number(settings.words) || 30)
    ),

    time: Math.min(
      180,
      Math.max(15, Number(settings.time) || 60)
    ),

    punctuation: Boolean(settings.punctuation),
    capitalization: Boolean(settings.capitalization),
    numbers: Boolean(settings.numbers),

    mistakes:
      settings.mistakes === "unlimited"
        ? "unlimited"
        : Math.min(
            20,
            Math.max(0, Number(settings.mistakes) || 0)
          )
  };
}

function settingsMatch(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function generateText(settings) {
  const count =
    settings.mode === "words"
      ? settings.words
      : Math.max(100, Math.ceil(settings.time * 5));

  const result = [];

  for (let i = 0; i < count; i++) {
    let word =
      WORDS[Math.floor(Math.random() * WORDS.length)];

    if (
      settings.numbers &&
      Math.random() < 0.16
    ) {
      word = String(
        Math.floor(Math.random() * 900) + 100
      );
    }

    if (
      settings.capitalization &&
      Math.random() < 0.24
    ) {
      word =
        word.charAt(0).toUpperCase() +
        word.slice(1);
    }

    if (
      settings.punctuation &&
      Math.random() < 0.18
    ) {
      const punctuation = [
        ",",
        ".",
        "!",
        "?",
        ";"
      ];

      word +=
        punctuation[
          Math.floor(
            Math.random() * punctuation.length
          )
        ];
    }

    result.push(word);
  }

  return result.join(" ");
}

function makeRoomCode() {
  let code;

  do {
    code = crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function createRoom(
  name,
  settings,
  visibility,
  ranked = false
) {
  const room = {
    code: makeRoomCode(),
    name: `${name}'s room`,
    settings,
    visibility,
    ranked,

    players: [],

    host: null,

    state: "lobby",

    text: "",
    textHash: "",

    startedAt: 0,
    endsAt: 0
  };

  rooms.set(room.code, room);

  return room;
}

function roomForSocket(socketId) {
  for (const room of rooms.values()) {
    if (
      room.players.some(
        player => player.id === socketId
      )
    ) {
      return room;
    }
  }

  return null;
}

function serializeRoom(room) {
  return {
    code: room.code,
    name: room.name,
    visibility: room.visibility,
    ranked: room.ranked,
    settings: room.settings,

    players: room.players.map(player => ({
      id: player.id,
      name: player.name,

      account: player.account
        ? {
            username: player.account.username,
            elo: player.account.elo
          }
        : null
    })),

    host: room.host,
    state: room.state
  };
}

function publicRooms() {
  return [...rooms.values()]
    .filter(
      room =>
        !room.ranked &&
        room.visibility === "public" &&
        room.state === "lobby" &&
        room.players.length < 2
    )
    .map(room => ({
      code: room.code,
      name: room.name,
      players: room.players.length,
      settings: room.settings
    }));
}

function emitPublicRooms() {
  io.emit(
    "rooms:update",
    publicRooms()
  );
}

function cleanupRoom(code) {
  const room = rooms.get(code);

  if (!room) return;

  if (timers.has(code)) {
    clearTimeout(timers.get(code));
    timers.delete(code);
  }

  rooms.delete(code);

  emitPublicRooms();
}

/* =========================================================
   ELO
========================================================= */

async function updateRankedElo(room, winnerId) {
  if (
    !room.ranked ||
    room.players.length !== 2
  ) {
    return;
  }

  const first = room.players[0];
  const second = room.players[1];

  if (!first.account || !second.account) {
    return;
  }

  const firstUser = await getUser(
    first.account.id
  );

  const secondUser = await getUser(
    second.account.id
  );

  if (!firstUser || !secondUser) {
    return;
  }

  const expectedFirst =
    1 /
    (
      1 +
      Math.pow(
        10,
        (secondUser.elo - firstUser.elo) / 400
      )
    );

  const scoreFirst =
    winnerId === first.id
      ? 1
      : 0;

  const firstK =
    firstUser.games < 20 ? 40 : 24;

  const secondK =
    secondUser.games < 20 ? 40 : 24;

  const newFirstElo = Math.round(
    firstUser.elo +
      firstK *
        (scoreFirst - expectedFirst)
  );

  const newSecondElo = Math.round(
    secondUser.elo +
      secondK *
        ((1 - scoreFirst) -
          (1 - expectedFirst))
  );

  await db(
    `
      UPDATE users
      SET
        elo = $1,
        games = games + 1,
        wins = wins + $2
      WHERE id = $3
    `,
    [
      newFirstElo,
      winnerId === first.id ? 1 : 0,
      firstUser.id
    ]
  );

  await db(
    `
      UPDATE users
      SET
        elo = $1,
        games = games + 1,
        wins = wins + $2
      WHERE id = $3
    `,
    [
      newSecondElo,
      winnerId === second.id ? 1 : 0,
      secondUser.id
    ]
  );

  io.to(first.id).emit(
    "rank:update",
    {
      elo: newFirstElo,
      delta:
        newFirstElo -
        firstUser.elo
    }
  );

  io.to(second.id).emit(
    "rank:update",
    {
      elo: newSecondElo,
      delta:
        newSecondElo -
        secondUser.elo
    }
  );
}

/* =========================================================
   RACE
========================================================= */

function finishRace(room, reason) {
  if (
    !room ||
    room.state === "finished"
  ) {
    return;
  }

  room.state = "finished";

  if (timers.has(room.code)) {
    clearTimeout(
      timers.get(room.code)
    );

    timers.delete(room.code);
  }

  const now = Date.now();

  const results =
    room.players.map(player => ({
      id: player.id,
      name: player.name,
      index: player.index || 0,

      elapsed:
        Math.max(
          0.001,
          (
            (player.finishAt || now) -
            room.startedAt
          ) / 1000
        ),

      finished: Boolean(
        player.finished
      ),

      errors: player.errors || 0
    }));

  let winnerId = null;

  if (room.settings.mode === "time") {
    const maxProgress =
      Math.max(
        ...results.map(
          result => result.index
        )
      );

    const leaders =
      results.filter(
        result =>
          result.index === maxProgress
      );

    if (leaders.length === 1) {
      winnerId = leaders[0].id;
    }
  } else {
    const finished =
      results
        .filter(
          result => result.finished
        )
        .sort(
          (a, b) =>
            a.elapsed -
            b.elapsed
        );

    if (finished.length) {
      winnerId = finished[0].id;
    }
  }

  io.to(room.code).emit(
    "battle:finish",
    {
      winnerId,
      results,
      total: room.text.length,
      reason,
      ranked: room.ranked
    }
  );

  if (
    room.ranked &&
    winnerId &&
    room.players.length === 2 &&
    reason !== "invalid-input" &&
    reason !== "disconnect"
  ) {
    updateRankedElo(
      room,
      winnerId
    ).catch(console.error);
  }

  setTimeout(
    () => cleanupRoom(room.code),
    15000
  );
}

function startRace(room) {
  if (
    !room ||
    room.players.length !== 2 ||
    room.state !== "lobby"
  ) {
    return;
  }

  room.state = "countdown";

  room.text =
    generateText(room.settings);

  room.textHash =
    crypto
      .createHash("sha256")
      .update(room.text)
      .digest("hex");

  for (const player of room.players) {
    player.index = 0;
    player.typed = "";
    player.finished = false;
    player.strikes = 0;
    player.errors = 0;
    player.lastAt = 0;
    player.finishAt = 0;
  }

  io.to(room.code).emit(
    "room:update",
    serializeRoom(room)
  );

  io.to(room.code).emit(
    "battle:prepare",
    {
      text: room.text,
      textHash: room.textHash,
      settings: room.settings
    }
  );

  let countdown = 3;

  io.to(room.code).emit(
    "battle:countdown",
    countdown
  );

  const countdownTimer =
    setInterval(() => {
      countdown--;

      io.to(room.code).emit(
        "battle:countdown",
        countdown
      );

      if (countdown <= 0) {
        clearInterval(
          countdownTimer
        );

        room.state = "racing";
        room.startedAt = Date.now();

        if (
          room.settings.mode === "time"
        ) {
          room.endsAt =
            room.startedAt +
            room.settings.time *
              1000;

          const timer =
            setTimeout(
              () =>
                finishRace(
                  room,
                  "time"
                ),
              room.settings.time *
                1000 +
                50
            );

          timers.set(
            room.code,
            timer
          );
        }

        io.to(room.code).emit(
          "battle:start",
          {
            started:
              room.startedAt,
            endsAt:
              room.endsAt
          }
        );
      }
    }, 1000);
}

function validateProgress(
  room,
  player,
  typed
) {
  if (
    typeof typed !== "string"
  ) {
    return {
      error: "invalid-input",
      index: player.index || 0
    };
  }

  const now = Date.now();

  if (
    now <
    room.startedAt - 1500
  ) {
    return {
      error: "early",
      index: player.index || 0
    };
  }

  if (
    room.settings.mode === "time" &&
    now >
      room.endsAt + 1000
  ) {
    return {
      error: "late",
      index: player.index || 0
    };
  }

  /*
    IMPORTANT:

    A normal typo is NOT a cheat.

    We calculate the longest correct
    prefix of the player's submitted
    text.

    Example:

      Server text:
      "hello world"

      Player types:
      "heX"

    Correct prefix:
      "he"

    The race continues.
  */

  let correctPrefix = 0;

  const maxLength =
    Math.min(
      typed.length,
      room.text.length
    );

  while (
    correctPrefix <
      maxLength &&
    typed[correctPrefix] ===
      room.text[correctPrefix]
  ) {
    correctPrefix++;
  }

  if (
    correctPrefix <
    (player.index || 0)
  ) {
    return {
      error: "backward",
      index: player.index || 0
    };
  }

  const delta =
    correctPrefix -
    (player.index || 0);

  const elapsed =
    Math.max(
      1,
      now -
        (player.lastAt ||
          room.startedAt)
    );

  const charactersPerSecond =
    delta /
    (elapsed / 1000);

  /*
    Large impossible bursts are
    suspicious, but ordinary typing
    mistakes are not.
  */

  if (
    delta > 80 &&
    charactersPerSecond > 45
  ) {
    return {
      error: "impossible-speed",
      index: player.index || 0
    };
  }

  player.index =
    correctPrefix;

  player.typed =
    typed.slice(
      0,
      correctPrefix
    );

  player.lastAt = now;

  return {
    error: null,
    index: correctPrefix
  };
}

/* =========================================================
   SOCKET CONNECTIONS
========================================================= */

io.on("connection", socket => {
  socket.emit(
    "rooms:update",
    publicRooms()
  );

  socket.emit(
    "online",
    io.engine.clientsCount
  );

  socket.on(
    "setName",
    name => {
      socket.data.name =
        cleanName(name);
    }
  );

  socket.on(
    "auth:identify",
    async () => {
      try {
        const token =
          socket.handshake.auth
            ?.token;

        if (token && JWT_SECRET) {
          const decoded =
            jwt.verify(
              token,
              JWT_SECRET
            );

          socket.data.userId =
            decoded.id;
        }
      } catch {}

      if (socket.data.userId) {
        const user =
          await getUser(
            socket.data.userId
          );

        socket.emit(
          "auth:state",
          {
            user: user
              ? publicUser(user)
              : null
          }
        );
      } else {
        socket.emit(
          "auth:state",
          {
            user: null
          }
        );
      }
    }
  );

  /*
    Ranked and Casual Quick Match.

    Ranked:
      - account required
      - no rooms
      - Elo matchmaking

    Casual:
      - account optional
      - quick match
      - no Elo requirement
  */

  socket.on(
    "quickMatch",
    async ({
      settings,
      mode = "casual"
    } = {}) => {
      const ranked =
        mode === "ranked";

      const normalized =
        normalizeSettings(
          settings
        );

      let account = null;

      if (ranked) {
        account =
          socket.data.userId
            ? await getUser(
                socket.data.userId
              )
            : null;

        if (!account) {
          return socket.emit(
            "error:msg",
            "Sign in to play Ranked."
          );
        }
      }

      const queue =
        ranked
          ? rankedQueue
          : casualQueue;

      /*
        Ranked matchmaking starts
        at ±250 Elo.

        Older entries can gradually
        widen their acceptable range.
      */

      const now = Date.now();

      const candidateIndex =
        queue.findIndex(entry => {
          if (
            entry.socketId ===
            socket.id
          ) {
            return false;
          }

          if (
            !settingsMatch(
              entry.settings,
              normalized
            )
          ) {
            return false;
          }

          if (!ranked) {
            return true;
          }

          const waitSeconds =
            (now -
              entry.queuedAt) /
            1000;

          const allowed =
            Math.min(
              600,
              250 +
                Math.floor(
                  waitSeconds /
                    5
                ) *
                  50
            );

          return (
            Math.abs(
              entry.elo -
                account.elo
            ) <= allowed
          );
        });

      if (
        candidateIndex === -1
      ) {
        queue.push({
          socketId: socket.id,
          settings: normalized,
          elo:
            account?.elo || 0,
          queuedAt: Date.now()
        });

        return socket.emit(
          "queue:waiting",
          {
            ranked
          }
        );
      }

      const opponent =
        queue.splice(
          candidateIndex,
          1
        )[0];

      const other =
        io.sockets.sockets.get(
          opponent.socketId
        );

      if (!other) {
        return socket.emit(
          "error:msg",
          "That match expired. Please try again."
        );
      }

      const otherAccount =
        ranked &&
        other.data.userId
          ? await getUser(
              other.data.userId
            )
          : null;

      const room =
        createRoom(
          cleanName(
            other.data.name
          ),
          normalized,
          "private",
          ranked
        );

      room.players.push({
        id: other.id,
        name: cleanName(
          other.data.name
        ),
        account: otherAccount
          ? publicUser(
              otherAccount
            )
          : null
      });

      room.players.push({
        id: socket.id,
        name: cleanName(
          socket.data.name
        ),
        account: account
          ? publicUser(account)
          : null
      });

      room.host = other.id;

      other.join(room.code);
      socket.join(room.code);

      io.to(room.code).emit(
        "room:update",
        serializeRoom(room)
      );

      /*
        CRITICAL:

        Quick Match starts automatically.

        There is no Start Battle
        button for Quick Match.
      */

      startRace(room);
    }
  );

  /*
    Casual room creation only.
  */

  socket.on(
    "createRoom",
    ({
      settings,
      visibility,
      name
    } = {}) => {
      const room =
        createRoom(
          cleanName(
            name ||
              socket.data.name
          ),
          normalizeSettings(
            settings
          ),
          visibility ===
            "private"
            ? "private"
            : "public",
          false
        );

      room.players.push({
        id: socket.id,
        name: cleanName(
          socket.data.name
        ),
        account: null
      });

      room.host = socket.id;

      socket.join(
        room.code
      );

      socket.emit(
        "room:created",
        serializeRoom(room)
      );

      emitPublicRooms();
    }
  );

  /*
    Ranked rooms are impossible.
  */

  socket.on(
    "joinRoom",
    rawCode => {
      const code =
        String(rawCode || "")
          .toUpperCase()
          .replace(
            /[^A-Z0-9]/g,
            ""
          );

      const room =
        rooms.get(code);

      if (
        !room ||
        room.ranked ||
        room.state !==
          "lobby" ||
        room.players.length >= 2
      ) {
        return socket.emit(
          "error:msg",
          "That casual room is unavailable."
        );
      }

      if (
        roomForSocket(
          socket.id
        )
      ) {
        return socket.emit(
          "error:msg",
          "You are already in a room."
        );
      }

      room.players.push({
        id: socket.id,
        name: cleanName(
          socket.data.name
        ),
        account: null
      });

      socket.join(
        room.code
      );

      io.to(room.code).emit(
        "room:update",
        serializeRoom(room)
      );

      emitPublicRooms();

      /*
        Custom room:

        The host can start the battle
        manually.

        Quick Match never reaches
        this code path.
      */
    }
  );

  socket.on(
    "startRoom",
    () => {
      const room =
        roomForSocket(
          socket.id
        );

      if (
        room &&
        !room.ranked &&
        room.host ===
          socket.id &&
        room.players.length ===
          2 &&
        room.state ===
          "lobby"
      ) {
        startRace(room);
      }
    }
  );

  socket.on(
    "race:progress",
    ({
      typed = ""
    } = {}) => {
      const room =
        roomForSocket(
          socket.id
        );

      if (
        !room ||
        room.state !==
          "racing"
      ) {
        return;
      }

      const player =
        room.players.find(
          p =>
            p.id ===
            socket.id
        );

      if (!player) {
        return;
      }

      const result =
        validateProgress(
          room,
          player,
          typed
        );

      if (result.error) {
        /*
          Ordinary typo:
          NOT an anti-cheat strike.

          Only actual suspicious
          progress manipulation gets
          strikes.
        */

        if (
          result.error ===
            "backward" ||
          result.error ===
            "impossible-speed"
        ) {
          player.strikes =
            (player.strikes || 0) +
            1;
        }

        /*
          Mistake limit.

          We only count actual
          incorrect characters that
          prevent prefix progress.
        */

        if (
          room.settings.mistakes !==
            "unlimited" &&
          result.error ===
            "backward"
        ) {
          player.errors =
            (player.errors || 0) +
            1;
        }

        socket.emit(
          "race:correction",
          {
            index:
              player.index || 0,
            reason:
              result.error
          }
        );

        if (
          player.strikes >= 5
        ) {
          socket.emit(
            "error:msg",
            "Suspicious race data was detected."
          );

          finishRace(
            room,
            "invalid-input"
          );
        }

        return;
      }

      socket
        .to(room.code)
        .emit(
          "race:opponent",
          {
            index:
              player.index
          }
        );

      /*
        Word race:
        finishing the text ends
        the race.

        Time race:
        server timer ends it.
      */

      if (
        player.index >=
        room.text.length
      ) {
        player.finished =
          true;

        player.finishAt =
          Date.now();

        if (
          room.settings.mode ===
          "words"
        ) {
          finishRace(
            room,
            "complete"
          );
        }
      }
    }
  );

  socket.on(
    "disconnect",
    () => {
      for (
        const queue of [
          casualQueue,
          rankedQueue
        ]
      ) {
        const index =
          queue.findIndex(
            entry =>
              entry.socketId ===
              socket.id
          );

        if (index >= 0) {
          queue.splice(
            index,
            1
          );
        }
      }

      const room =
        roomForSocket(
          socket.id
        );

      if (room) {
        if (
          room.state ===
            "racing" ||
          room.state ===
            "countdown"
        ) {
          io.to(room.code).emit(
            "error:msg",
            "Your opponent disconnected."
          );

          finishRace(
            room,
            "disconnect"
          );
        } else {
          cleanupRoom(
            room.code
          );
        }
      }

      emitPublicRooms();
    }
  );
});

/* =========================================================
   LEADERBOARD
========================================================= */

app.get(
  "/api/leaderboard",
  async (req, res) => {
    if (!pool) {
      return res.json({
        players: []
      });
    }

    try {
      const result =
        await db(`
          SELECT
            username,
            elo,
            games,
            wins
          FROM users
          ORDER BY elo DESC
          LIMIT 50
        `);

      res.json({
        players:
          result.rows
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Could not load leaderboard."
      });
    }
  }
);

/* =========================================================
   MAINTENANCE
========================================================= */

setInterval(() => {
  for (
    const queue of [
      casualQueue,
      rankedQueue
    ]
  ) {
    for (
      let i =
        queue.length - 1;
      i >= 0;
      i--
    ) {
      if (
        !io.sockets.sockets.get(
          queue[i].socketId
        )
      ) {
        queue.splice(
          i,
          1
        );
      }
    }
  }

  for (
    const [
      code,
      room
    ] of rooms
  ) {
    if (
      room.state ===
        "racing" &&
      room.settings.mode ===
        "time" &&
      Date.now() >=
        room.endsAt
    ) {
      finishRace(
        room,
        "time"
      );
    }
  }
}, 5000);

/* =========================================================
   START
========================================================= */

initializeDatabase()
  .then(() => {
    server.listen(
      PORT,
      () => {
        console.log(
          `TypeRush running on port ${PORT}`
        );
      }
    );
  })
  .catch(error => {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  });
```