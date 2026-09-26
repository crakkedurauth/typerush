# TypeRush — polished multiplayer typing battles

## Run
Node.js 18+:
npm install
npm start

Open http://localhost:3000

## Included
- Quick-match queue with matching settings.
- Public rooms and private room codes/invite URLs.
- Words or timed races.
- Punctuation, capitalization, and number toggles.
- Real-time opponent progress.
- Server-authoritative race text and timer.
- Anti-cheat validation: exact text-prefix verification, no backwards progress, early/late input checks, and implausible-speed checks.
- Disconnect and timer cleanup.
- Results, WPM, accuracy, personal best, rematch.
- Responsive modern UI.
- `/health` endpoint for deployment health checks.

## Anti-cheat note
The server generates and retains the race text and validates each submitted typing prefix against it. The server also controls the timer and race completion. This prevents the common client-side “set progress to 100%” exploit.

No browser game can make cheating mathematically impossible when a user controls their own device. For a public ranked ladder, add authentication, persistent ratings, stronger behavioral detection, rate limiting, and reporting/moderation.
