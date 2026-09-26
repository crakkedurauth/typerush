# TypeRush — Multiplayer Typing Battles

A full-stack HTML/CSS/JavaScript multiplayer typing game using Node.js, Express, and Socket.IO.

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Visit http://localhost:3000

For testing multiplayer locally, open the URL in two browser windows/tabs.

## Features

- Quick Match queue pairs players using matching race settings.
- Public rooms appear in the live room list.
- Private rooms can be joined using a room code or invite URL.
- Word-count or timed races.
- Toggles for punctuation, capitalization, and numbers.
- Live opponent progress.
- Countdown, WPM, accuracy, result screen, rematch flow.
- Persistent display name and personal best in localStorage.
- Responsive modern UI with animations.

## Production

Deploy the Node server (not just the static files) because matchmaking and rooms use Socket.IO. Set `PORT` if your host requires a specific port.
