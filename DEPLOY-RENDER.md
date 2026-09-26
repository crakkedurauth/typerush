# Deploy TypeRush on Render

## Recommended
Use a Render Web Service with a persistent disk because the app stores accounts and ELO in SQLite.

### Manual settings
- Runtime: Node
- Build command: `npm install --omit=dev`
- Start command: `npm start`
- Health check: `/health`

### Environment variables
- `NODE_ENV=production`
- `SESSION_SECRET` = a long random secret
- `DB_PATH=/var/data/typing-battles.db`

### Persistent disk
Mount a Render persistent disk at `/var/data`. Without it, SQLite account/ELO data can be lost when the service is replaced/redeployed.

### WebSockets
Socket.IO runs through the same Render Web Service; do not deploy this as a static site.

## GitHub
Do NOT commit `node_modules` or `typing-battles.db`. Render will install dependencies itself.

## Free-tier note
A persistent disk is not available on every Render plan. If your plan does not allow a persistent disk, do not use this SQLite build for persistent ranked accounts; move the database to PostgreSQL instead.
