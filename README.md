# TypeRush — Render-ready multiplayer typing battles

## Local
```bash
npm install
npm start
```
Open http://localhost:3000.

## Render
Create a **Web Service** from this repository.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Set these environment variables:

- `NODE_ENV=production`
- `SESSION_SECRET=` a long random secret (32+ bytes)
- `DB_PATH=/var/data/typing-battles.db` when using a Render persistent disk mounted at `/var/data`

For account/ELO persistence, attach a Render persistent disk and mount it at `/var/data`. Without a persistent disk, SQLite data can be lost when the service is replaced or redeployed.

## Features
- Casual quick match without an account
- Ranked quick match with accounts and ELO matchmaking
- Public/private rooms
- Word and time modes
- Punctuation, capitalization and numbers toggles
- Mistake limits or unlimited mistakes
- Server-side prefix validation and basic speed sanity checks
- `/health` endpoint for Render
- Binds to `0.0.0.0` and `process.env.PORT`

## Important
Do not commit `node_modules` or `typing-battles.db`. Render installs dependencies during the build.
