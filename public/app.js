```js
const socket = io({
  autoConnect: true
});

/* =========================================================
   HELPERS
========================================================= */

const $ = selector =>
  document.querySelector(selector);

const $$ = selector =>
  [...document.querySelectorAll(selector)];

const show = id => {
  $$(".view").forEach(view =>
    view.classList.remove("active")
  );

  const target = $(`#${id}`);

  if (target) {
    target.classList.add("active");
  }
};

const escapeHTML = value =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function toast(message) {
  const element = $("#toast");

  if (!element) return;

  element.textContent = message;
  element.classList.add("show");

  clearTimeout(
    toast.timeout
  );

  toast.timeout =
    setTimeout(
      () =>
        element.classList.remove(
          "show"
        ),
      2500
    );
}

/* =========================================================
   STATE
========================================================= */

let playMode = "casual";

let authUser = null;

let authTab = "login";

let settings = {
  mode: "words",

  words: 30,

  time: 60,

  punctuation: false,

  capitalization: false,

  numbers: false,

  mistakes: "unlimited"
};

let currentRoom = null;

let raceText = "";

let raceStarted = false;

let raceFinished = false;

let localTyped = "";

let countdown = 0;

let raceStartTime = 0;

let raceEndTime = 0;

let progressTimer = null;

let bestWpm =
  Number(
    localStorage.getItem(
      "typerush-best-wpm"
    )
  ) || 0;

/* =========================================================
   NAME
========================================================= */

let playerName =
  localStorage.getItem(
    "typerush-name"
  ) ||
  `Racer${Math.floor(
    Math.random() * 9999
  )}`;

$("#playerName").value =
  playerName;

/* =========================================================
   INTRO
========================================================= */

setTimeout(() => {
  $("#introStage")?.classList.add(
    "done"
  );
}, 2100);

/* =========================================================
   MODE SELECTION
========================================================= */

function updateModeUI() {
  $("#casualModeBtn")
    ?.classList.toggle(
      "active",
      playMode === "casual"
    );

  $("#rankedModeBtn")
    ?.classList.toggle(
      "active",
      playMode === "ranked"
    );

  const ranked =
    playMode === "ranked";

  $("#createRoomBtn")
    ?.classList.toggle(
      "hidden",
      ranked
    );

  $("#publicRoomsPanel")
    ?.classList.toggle(
      "hidden",
      ranked
    );

  $("#quickMatchBtn").textContent =
    ranked
      ? "🏆 Find Ranked Match"
      : "⚡ Quick Match";

  if (authUser) {
    $("#accountBtn").textContent =
      `${authUser.username} · ${authUser.elo} Elo`;

    $("#rankCard")
      ?.classList.remove(
        "hidden"
      );
  } else {
    $("#accountBtn").textContent =
      "Sign in";

    $("#rankCard")
      ?.classList.add(
        "hidden"
      );
  }
}

$("#casualModeBtn").onclick =
  () => {
    playMode = "casual";
    updateModeUI();
  };

$("#rankedModeBtn").onclick =
  () => {
    if (!authUser) {
      openAuth("login");
      return;
    }

    playMode = "ranked";
    updateModeUI();
  };

/* =========================================================
   AUTH
========================================================= */

async function loadAccount() {
  try {
    const response =
      await fetch(
        "/api/me"
      );

    const data =
      await response.json();

    authUser =
      data.user || null;

    if (authUser) {
      $("#homeElo").textContent =
        authUser.elo;

      $("#profileName").textContent =
        authUser.username;

      $("#profileElo").textContent =
        authUser.elo;

      $("#profileGames").textContent =
        authUser.games;

      $("#profileWins").textContent =
        authUser.wins;

      socket.emit(
        "setName",
        authUser.username
      );
    }

    updateModeUI();
  } catch {
    updateModeUI();
  }
}

function openAuth(tab = "login") {
  authTab = tab;

  $("#accountModal")
    .classList.remove(
      "hidden"
    );

  $("#authEmail")
    .classList.toggle(
      "hidden",
      tab !== "signup"
    );

  $("#authUsername").placeholder =
    tab === "signup"
      ? "Username"
      : "Username or email";

  $("#authSubmit").textContent =
    tab === "signup"
      ? "Create account"
      : "Sign in";

  $("#authTitle").textContent =
    tab === "signup"
      ? "Create your ranked account"
      : "Sign in to Ranked";

  $("#authError").textContent =
    "";
}

async function submitAuth() {
  const endpoint =
    authTab === "signup"
      ? "/api/auth/signup"
      : "/api/auth/login";

  const body =
    authTab === "signup"
      ? {
          username:
            $("#authUsername")
              .value,

          email:
            $("#authEmail")
              .value,

          password:
            $("#authPassword")
              .value
        }
      : {
          login:
            $("#authUsername")
              .value,

          password:
            $("#authPassword")
              .value
        };

  const response =
    await fetch(
      endpoint,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    $("#authError").textContent =
      data.error ||
      "Authentication failed.";

    return;
  }

  authUser =
    data.user;

  playerName =
    authUser.username;

  localStorage.setItem(
    "typerush-name",
    playerName
  );

  socket.emit(
    "setName",
    playerName
  );

  $("#accountModal")
    .classList.add(
      "hidden"
    );

  updateModeUI();

  toast(
    authTab === "signup"
      ? "Account created."
      : "Signed in."
  );
}

$$("[data-auth-tab]")
  .forEach(button => {
    button.onclick =
      () =>
        openAuth(
          button.dataset
            .authTab
        );
  });

$("#authSubmit").onclick =
  submitAuth;

$("#closeAccount").onclick =
  () =>
    $("#accountModal")
      .classList.add(
        "hidden"
      );

$("#accountBtn").onclick =
  () => {
    if (authUser) {
      $("#profileModal")
        .classList.remove(
          "hidden"
        );
    } else {
      openAuth();
    }
  };

$("#closeProfile").onclick =
  () =>
    $("#profileModal")
      .classList.add(
        "hidden"
      );

$("#logoutBtn").onclick =
  async () => {
    await fetch(
      "/api/auth/logout",
      {
        method: "POST"
      }
    );

    authUser = null;

    playMode =
      "casual";

    $("#profileModal")
      .classList.add(
        "hidden"
      );

    updateModeUI();

    toast(
      "Signed out."
    );
  };

/* =========================================================
   PLAYER NAME
========================================================= */

$("#playerName")
  ?.addEventListener(
    "input",
    event => {
      playerName =
        event.target.value
          .trim()
          .slice(0, 18) ||
        "Racer";

      localStorage.setItem(
        "typerush-name",
        playerName
      );

      socket.emit(
        "setName",
        playerName
      );
    }
  );

/* =========================================================
   SETTINGS
========================================================= */

function updateSettingsUI() {
  $$(".mode-setting")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.mode ===
          settings.mode
      );
    });

  $("#wordsSetting")
    ?.classList.toggle(
      "hidden",
      settings.mode !==
        "words"
    );

  $("#timeSetting")
    ?.classList.toggle(
      "hidden",
      settings.mode !==
        "time"
    );

  $$("[data-mistakes]")
    .forEach(button => {
      button.classList.toggle(
        "active",
        String(
          button.dataset
            .mistakes
        ) ===
          String(
            settings.mistakes
          )
      );
    });
}

$$(".mode-setting")
  .forEach(button => {
    button.onclick =
      () => {
        settings.mode =
          button.dataset.mode;

        updateSettingsUI();
      };
  });

$("#wordsValue")
  ?.addEventListener(
    "input",
    event => {
      settings.words =
        Number(
          event.target.value
        );
    }
  );

$("#timeValue")
  ?.addEventListener(
    "input",
    event => {
      settings.time =
        Number(
          event.target.value
        );
    }
  );

[
  "punctuation",
  "capitalization",
  "numbers"
].forEach(key => {
  $(`#${key}`)
    ?.addEventListener(
      "change",
      event => {
        settings[key] =
          event.target.checked;
      }
    );
});

$$("[data-mistakes]")
  .forEach(button => {
    button.onclick =
      () => {
        const value =
          button.dataset
            .mistakes;

        settings.mistakes =
          value ===
          "unlimited"
            ? "unlimited"
            : Number(value);

        updateSettingsUI();
      };
  });

updateSettingsUI();

/* =========================================================
   QUICK MATCH
========================================================= */

$("#quickMatchBtn").onclick =
  () => {
    if (
      playMode === "ranked" &&
      !authUser
    ) {
      openAuth();
      return;
    }

    socket.emit(
      "setName",
      playerName
    );

    socket.emit(
      "quickMatch",
      {
        settings,
        mode: playMode
      }
    );

    show(
      "lobbyView"
    );

    $("#lobbyTitle")
      .textContent =
      playMode ===
      "ranked"
        ? "Finding Ranked Match"
        : "Finding Casual Match";

    $("#startBattleBtn")
      .classList.add(
        "hidden"
      );
  };

/* =========================================================
   CASUAL ROOMS
========================================================= */

$("#createRoomBtn").onclick =
  () => {
    if (
      playMode !==
      "casual"
    ) {
      return;
    }

    show(
      "setupView"
    );
  };

$("#createRoomConfirm")
  ?.addEventListener(
    "click",
    () => {
      socket.emit(
        "setName",
        playerName
      );

      const visibility =
        $("#privateRoom")
          .checked
          ? "private"
          : "public";

      socket.emit(
        "createRoom",
        {
          name:
            playerName,

          visibility,

          settings
        }
      );
    }
  );

$("#cancelSetup")
  ?.addEventListener(
    "click",
    () =>
      show(
        "homeView"
      )
  );

$("#joinCodeBtn")
  ?.addEventListener(
    "click",
    () => {
      const code =
        $("#joinCode")
          .value
          .trim();

      if (!code) {
        toast(
          "Enter a room code."
        );

        return;
      }

      socket.emit(
        "setName",
        playerName
      );

      socket.emit(
        "joinRoom",
        code
      );
    }
  );

/* =========================================================
   PUBLIC ROOMS
========================================================= */

function renderRooms(rooms) {
  const list =
    $("#roomList");

  if (!list) return;

  if (!rooms.length) {
    list.innerHTML =
      `
        <div class="empty">
          No public rooms yet.
        </div>
      `;

    return;
  }

  list.innerHTML =
    rooms
      .map(
        room => `
          <div class="room-row">
            <div>
              <strong>
                ${escapeHTML(
                  room.name
                )}
              </strong>

              <small>
                ${room.players}/2 ·
                ${
                  room.settings.mode ===
                  "time"
                    ? `${room.settings.time}s`
                    : `${room.settings.words} words`
                }
              </small>
            </div>

            <button
              class="btn secondary join-public"
              data-code="${room.code}"
            >
              Join
            </button>
          </div>
        `
      )
      .join("");

  $$(".join-public")
    .forEach(button => {
      button.onclick =
        () => {
          socket.emit(
            "setName",
            playerName
          );

          socket.emit(
            "joinRoom",
            button.dataset
              .code
          );
        };
    });
}

$("#refreshRooms")
  ?.addEventListener(
    "click",
    () =>
      socket.emit(
        "rooms:request"
      )
  );

/* =========================================================
   ROOM STATE
========================================================= */

function renderRoom(room) {
  currentRoom =
    room;

  show(
    "lobbyView"
  );

  $("#lobbyCode")
    .textContent =
    room.code;

  $("#lobbyTitle")
    .textContent =
    room.ranked
      ? "Ranked Match"
      : "Casual Room";

  $("#lobbyPlayers")
    .innerHTML =
      room.players
        .map(
          player => `
            <div class="player-card">
              <strong>
                ${escapeHTML(
                  player.name
                )}
              </strong>

              ${
                player.account
                  ? `
                    <small>
                      ${player.account.elo} Elo
                    </small>
                  `
                  : ""
              }
            </div>
          `
        )
        .join("");

  /*
    IMPORTANT:

    Ranked and Quick Match never
    expose Start Battle.

    Only a manually-created
    casual room host gets it.
  */

  const manualRoom =
    !room.ranked &&
    room.visibility !==
      "private-matchmaking";

  const showStart =
    manualRoom &&
    room.players.length ===
      2 &&
    room.host ===
      socket.id &&
    room.state ===
      "lobby";

  $("#startBattleBtn")
    .classList.toggle(
      "hidden",
      !showStart
    );

  $("#waitingMessage")
    .textContent =
    room.players.length <
    2
      ? "Waiting for another player…"
      : showStart
        ? "Both players are ready."
        : "Starting…";
}

$("#startBattleBtn")
  .onclick =
  () =>
    socket.emit(
      "startRoom"
    );

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
  "rooms:update",
  rooms =>
    renderRooms(
      rooms
    )
);

socket.on(
  "room:created",
  room => {
    renderRoom(
      room
    );

    const link =
      `${location.origin}/?room=${room.code}`;

    $("#roomLink")
      .value = link;

    $("#roomInvite")
      .classList.remove(
        "hidden"
      );
  }
);

socket.on(
  "room:update",
  room =>
    renderRoom(
      room
    )
);

socket.on(
  "queue:waiting",
  data => {
    $("#startBattleBtn")
      .classList.add(
        "hidden"
      );

    $("#waitingMessage")
      .textContent =
      data.ranked
        ? "Searching for a player near your Elo…"
        : "Searching for another player…";
  }
);

socket.on(
  "battle:prepare",
  data => {
    raceText =
      data.text;

    localTyped =
      "";

    raceFinished =
      false;

    $("#raceText")
      .textContent =
      raceText;

    $("#typingInput")
      .value =
      "";

    $("#typingInput")
      .disabled =
      true;

    show(
      "battleView"
    );
  }
);

socket.on(
  "battle:countdown",
  value => {
    countdown =
      value;

    $("#countdown")
      .textContent =
      value > 0
        ? value
        : "GO!";

    $("#countdownOverlay")
      .classList.remove(
        "hidden"
      );

    if (value <= 0) {
      setTimeout(
        () =>
          $("#countdownOverlay")
            .classList.add(
              "hidden"
            ),
        450
      );
    }
  }
);

socket.on(
  "battle:start",
  data => {
    raceStarted =
      true;

    raceStartTime =
      Date.now();

    raceEndTime =
      data.endsAt || 0;

    $("#typingInput")
      .disabled =
      false;

    $("#typingInput")
      .focus();

    startRaceTimer();
  }
);

socket.on(
  "race:opponent",
  data => {
    const total =
      raceText.length;

    const percentage =
      total
        ? (data.index /
            total) *
          100
        : 0;

    $("#opponentProgress")
      .style.width =
      `${percentage}%`;
  }
);

socket.on(
  "race:correction",
  data => {
    /*
      Do NOT erase the player's
      text when they make a typo.

      Normal mistakes are part
      of the game.
    */

    if (
      data.reason ===
        "backward" ||
      data.reason ===
        "impossible-speed"
    ) {
      toast(
        "That progress update was rejected."
      );
    }
  }
);

socket.on(
  "rank:update",
  data => {
    if (!authUser)
      return;

    authUser.elo =
      data.elo;

    $("#homeElo")
      .textContent =
      data.elo;

    $("#profileElo")
      .textContent =
      data.elo;

    $("#accountBtn")
      .textContent =
      `${authUser.username} · ${data.elo} Elo`;

    const sign =
      data.delta >= 0
        ? "+"
        : "";

    toast(
      `${sign}${data.delta} Elo`
    );
  }
);

socket.on(
  "battle:finish",
  data => {
    raceFinished =
      true;

    raceStarted =
      false;

    stopRaceTimer();

    const mine =
      data.results.find(
        result =>
          result.id ===
          socket.id
      );

    const opponent =
      data.results.find(
        result =>
          result.id !==
          socket.id
      );

    let title =
      "Race complete";

    if (
      data.winnerId ===
      socket.id
    ) {
      title =
        "You won!";
    } else if (
      data.winnerId
    ) {
      title =
        "You lost";
    } else {
      title =
        "Draw";
    }

    $("#resultTitle")
      .textContent =
      title;

    $("#resultSubtitle")
      .textContent =
      data.reason ===
      "time"
        ? "Time's up."
        : data.reason ===
            "disconnect"
          ? "Your opponent disconnected."
          : data.reason ===
              "mistakes"
            ? "The mistake limit was reached."
            : "Race complete.";

    const wpm =
      mine
        ? Math.round(
            (
              mine.index /
              5
            ) /
            Math.max(
              1 / 60,
              mine.elapsed /
                60
            )
          )
        : 0;

    $("#resultWpm")
      .textContent =
      wpm;

    if (
      wpm >
      bestWpm
    ) {
      bestWpm =
        wpm;

      localStorage.setItem(
        "typerush-best-wpm",
        bestWpm
      );

      $("#bestWpm")
        .textContent =
        bestWpm;
    }

    show(
      "resultView"
    );
  }
);

/* =========================================================
   TYPING
========================================================= */

$("#typingInput")
  .addEventListener(
    "input",
    event => {
      if (
        !raceStarted ||
        raceFinished
      ) {
        return;
      }

      localTyped =
        event.target.value;

      /*
        Send the complete local
        input.

        The server determines
        the authoritative correct
        prefix.

        A typo does NOT end
        the race.
      */

      socket.emit(
        "race:progress",
        {
          typed:
            localTyped
        }
      );

      updateLocalProgress();
    }
  );

function updateLocalProgress() {
  const percentage =
    raceText.length
      ? Math.min(
          100,
          (
            localTyped.length /
            raceText.length
          ) *
            100
        )
      : 0;

  $("#playerProgress")
    .style.width =
    `${percentage}%`;
}

/* =========================================================
   TIMER
========================================================= */

function startRaceTimer() {
  stopRaceTimer();

  progressTimer =
    setInterval(() => {
      if (
        !raceStarted
      ) {
        return;
      }

      if (
        raceEndTime
      ) {
        const remaining =
          Math.max(
            0,
            raceEndTime -
              Date.now()
          );

        $("#raceTimer")
          .textContent =
          `${Math.ceil(
            remaining /
              1000
          )}`;

        if (
          remaining <=
          0
        ) {
          stopRaceTimer();
        }
      } else {
        const elapsed =
          Date.now() -
          raceStartTime;

        $("#raceTimer")
          .textContent =
          `${Math.floor(
            elapsed /
              1000
          )}`;
      }
    }, 100);
}

function stopRaceTimer() {
  if (
    progressTimer
  ) {
    clearInterval(
      progressTimer
    );

    progressTimer =
      null;
  }
}

/* =========================================================
   RETURN HOME
========================================================= */

$$(
  "[data-home]"
).forEach(
  button => {
    button.onclick =
      () => {
        stopRaceTimer();

        raceStarted =
          false;

        raceFinished =
          false;

        show(
          "homeView"
        );
      };
  }
);

/* =========================================================
   COPY ROOM LINK
========================================================= */

$("#copyRoomLink")
  ?.addEventListener(
    "click",
    async () => {
      await navigator.clipboard.writeText(
        $("#roomLink")
          .value
      );

      toast(
        "Invite link copied."
      );
    }
  );

/* =========================================================
   INITIALIZATION
========================================================= */

socket.emit(
  "setName",
  playerName
);

loadAccount();

updateModeUI();

$("#bestWpm")
  .textContent =
  bestWpm || "—";
```