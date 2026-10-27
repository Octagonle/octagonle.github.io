# Accounts (removed for now)

Snapshot of the game from before sign-in was removed (2026-10-26). These versions let players create a username/password account so their streaks and win % followed them across devices.

- `server.mjs`: accounts (scrypt password hashes, session cookies), stats API, SQLite storage (`node:sqlite`, Node 22.13+)
- `app.js`, `index.html`, `styles.css`: the account button, sign-in/sign-up modal and server-synced stats

To bring accounts back, copy these over the current files (`server.mjs`, `public/js/…`, `public/index.html`, `public/css/…`), keeping any fighter-data or game changes made since, and add `data/` back to `.gitignore`.
