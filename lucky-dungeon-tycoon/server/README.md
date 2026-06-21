# Lucky City Tycoon — Backend (Phase 1)

A small TypeScript backend that adds **anonymous device accounts** and **cloud
saves** to the game, without breaking its offline-first design. The client keeps
playing entirely from `localStorage`; this server is a backup/sync layer that
takes over progress between devices and reinstalls.

It reuses the game's own engine (`../src`) to validate and clamp every uploaded
save, so the same anti-cheat rules run on the client and the server — the
foundation for the later phases (leaderboards, server-side economy).

## API

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/health` | — | Liveness + version. |
| `POST /api/v1/accounts` | — | Create an anonymous account → `{ accountId, token }`. |
| `GET /api/v1/save` | Bearer | Fetch the cloud save → `{ code, score, rev, updatedAt }` (`code` is null if none). |
| `PUT /api/v1/save` | Bearer | Upload `{ code }`. `200` if stored, `409` if a higher-progress save already exists (returned in the body so the client adopts it). |

**Conflict rule — highest progress wins.** A save is accepted only when its
score (lifetime gold earned, recomputed server-side from the clamped save) is at
least the stored score. An out-of-date device can never overwrite newer
progress.

## Run locally (no database)

```bash
cd server
npm install
npm test          # compiles + runs the API test suite
npm run build && node dist/server/src/index.js   # in-memory store, port 8787
curl localhost:8787/api/v1/health
```

Without `DATABASE_URL` the server uses an in-memory store (data lost on
restart) — fine for development and tests.

## Deploy on your VPS (Ubuntu, Docker)

Prerequisites: Docker + the Compose plugin.

```bash
# one-time
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker "$USER" && newgrp docker
```

Then, from the repo on the server:

```bash
# 1. Build the web bundle (the PWA Caddy will serve)
npm install
npm run build:web                     # produces ../dist-web

# 2. Configure and launch the stack
cd server
cp .env.example .env
nano .env                             # set a strong POSTGRES_PASSWORD
docker compose up -d --build
```

This starts three containers: **Postgres**, the **API**, and **Caddy** (serving
`../dist-web` on port 80 and proxying `/api`). Visit `http://YOUR_SERVER_IP/`.

### HTTP now, HTTPS when you have a domain

On a bare IP the stack serves plain **HTTP** (`SITE_ADDRESS=:80`). That's enough
to test cloud save in a browser, but note:

- **PWA install** and **service workers** require HTTPS (except on
  `localhost`).
- The packaged **iOS/Android** apps block plain-HTTP requests by default, so
  mobile cloud-sync needs HTTPS too.

When you point a domain at the server, set `SITE_ADDRESS=tycoon.example.com` in
`.env` and `docker compose up -d` — Caddy fetches a Let's Encrypt certificate
automatically (ports 80 + 443 must be open and DNS must resolve to this VPS).

## How the client connects

- **Web served by this VPS:** the app calls the API at the same origin
  (`/api/...`) — nothing to configure.
- **Packaged mobile apps:** they have no web origin, so set the absolute API URL
  before the app boots, e.g. in `index.html`:
  ```html
  <script>window.LCT_API_BASE = 'https://tycoon.example.com';</script>
  ```
  Until an HTTPS endpoint exists, mobile simply stays offline-only (the game is
  unaffected).

## Notes & next phases

- Accounts are anonymous (a device token in `localStorage`). Email/Google
  sign-in can be layered on later without changing the save protocol.
- Phase 2 (leaderboards) can read the `score` column directly; the sanitised
  profile is also stored as `JSONB` for richer future queries.
