# TypeRush — Render deployment

## Why the previous deploy failed

The previous repository allowed Render to select Node 26. `better-sqlite3@11.8.1` then attempted a native build against Node 26 and failed. This repository pins Node to 20.x so Render uses the compatible Node LTS line.

## Render Web Service

Use a **Web Service**, not a Static Site.

- Build Command: `npm ci --omit=dev`
- Start Command: `npm start`
- Health Check Path: `/health`
- Runtime: Node

The repository includes `.nvmrc`, `.node-version`, `package.json` engines, and `render.yaml` all targeting Node 20.

## Environment variables

Render should have:

- `NODE_ENV=production`
- `SESSION_SECRET` — generate a long random secret in Render
- `DB_PATH=/var/data/typing-battles.db`

The included `render.yaml` attaches a 1 GB persistent disk at `/var/data` on the Starter plan. This is required if SQLite data (accounts/ELO) must survive restarts and deploys.

## Important

Do not commit `node_modules/` or `typing-battles.db*`. Render installs Linux-compatible dependencies during `npm ci` and creates the database on the persistent disk.

If you want to run on a plan without persistent disks, use PostgreSQL for production account/ELO persistence instead of SQLite.

## After deployment

Open:

`https://YOUR-RENDER-SERVICE.onrender.com/health`

It should return JSON containing `ok: true`.

Then open the normal service URL and test signup/login, Casual Quick Match, and Ranked Quick Match with two browser sessions.


## Render authentication
Set `SESSION_SECRET` in the Render Environment Variables. Do not commit it to GitHub. The frontend authentication requests use same-origin credentials and display API errors directly in the UI.
