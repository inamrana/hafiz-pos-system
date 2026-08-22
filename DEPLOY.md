# Deploying Hafiz Stationers POS

This is a **single-user, single-shop** app — no signup, no login, no shop
codes. Whoever can reach the URL (or run the desktop app) has full access, so
treat the deployment URL as private. Data access goes through
[`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts), which
works two ways:

- **Local file** (`file:...`) — zero setup, used automatically in dev, in the
  Electron desktop app, and for self-hosted/offline deployments (VPS, Docker).
- **Turso** (remote libSQL over HTTP) — a hosted, SQLite-compatible database
  with a free tier. This is what makes **Vercel** (and other serverless
  platforms) work, since there's no local disk involved at all.

Pick whichever fits how you want to run this.

---

## Option A — Vercel + Turso (free, no server to manage)

### 1. Create a free Turso database

1. Sign up at [turso.tech](https://turso.tech) (no card required).
2. Install the CLI or use their web dashboard to create a database:
   ```bash
   turso db create hafiz-pos
   ```
3. Get the connection URL and an auth token:
   ```bash
   turso db show hafiz-pos --url
   turso db tokens create hafiz-pos
   ```

### 2. Deploy to Vercel

1. Import the GitHub repo into Vercel as a new project (framework preset: Next.js,
   auto-detected).
2. Add environment variables (**Project Settings → Environment Variables**):

   | Variable | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the URL from `turso db show` (starts with `libsql://`) |
   | `TURSO_AUTH_TOKEN` | the token from `turso db tokens create` |

3. Deploy. The schema creates itself automatically on first request — no
   separate migration step, no signup screen. Visit the deployed URL and it's
   ready to use immediately.

That's it — no volumes, no Dockerfile, no server to patch. Turso's free tier
has real limits (storage, row reads/writes per month); check their current
pricing page before relying on it long-term.

Since there's no login, consider restricting who can reach the URL — e.g.
Vercel's password-protection feature (paid plans) or simply not sharing the
link.

---

## Option B — Docker (self-hosted, works with or without Turso)

```bash
# Build and start (uses the local-file database by default)
docker compose up -d --build

curl -I http://localhost:3000/
docker compose logs -f
```

Data lives in the `pos-data` named volume (`/app/data` in the container). To
use Turso instead of the local file even when self-hosting, just set
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` in `docker-compose.yml`'s `environment:`
block — the app picks whichever is configured automatically.

To back up the local-file volume:

```bash
docker run --rm -v hafiz-pos-solo_pos-data:/data -v "$PWD/backup:/backup" \
  alpine tar czf /backup/pos-data-$(date +%F).tar.gz -C /data .
```

Put Docker behind a reverse proxy (Caddy or nginx) for HTTPS if exposing it
beyond your own machine/network.

---

## Option C — Local desktop app (Electron)

This is the simplest way to run it just for yourself, fully offline:

```bash
npm install
npm run electron:dev   # dev mode, hot reload
npm run electron:pack  # builds a Windows installer into dist/
```

The desktop build stores its database as a local file — no account, no
internet connection required.

---

## Option D — Plain VPS (no Docker)

Requires Node.js 20+.

```bash
git clone <your-repo-url> hafiz-pos-solo
cd hafiz-pos-solo
npm ci
npm run build

# Local file (default) — set DATA_DIR to a persistent disk
DATA_DIR=/var/lib/hafiz-pos/data NODE_ENV=production PORT=3000 node .next/standalone/server.js

# Or against Turso instead — TURSO_DATABASE_URL takes priority over DATA_DIR
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... NODE_ENV=production PORT=3000 node .next/standalone/server.js
```

`output: 'standalone'` doesn't auto-copy static assets, so before running you must:

```bash
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

### HTTPS via a reverse proxy

Never expose Next's port 3000 directly to the internet — put a reverse proxy in
front for TLS. Caddy is the simplest (automatic HTTPS):

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TURSO_DATABASE_URL` | Only for Turso | — | If set, the app uses Turso instead of a local file. Takes priority over `DATA_DIR`. |
| `TURSO_AUTH_TOKEN` | Only for Turso | — | Required alongside `TURSO_DATABASE_URL`. |
| `DATA_DIR` | Only for local-file mode | `./data` | Where the local database file lives. Ignored if `TURSO_DATABASE_URL` is set. Point at a persistent, non-network-mounted disk. |
| `PORT` | No | `3000` | Port the Node server listens on. |
| `NODE_ENV` | Recommended | — | Set to `production` for deployments. |

No secrets or session signing are required — there's no login.

---

## First run

Nothing to set up — open the app and start using it. Go to **Settings** to
set your shop name, near-expiry threshold, etc.

---

## Backups

- **Turso**: use `turso db shell hafiz-pos .dump` or Turso's built-in
  point-in-time recovery (check their current docs for retention on the free
  tier).
- **Local file / Docker / VPS / Electron**: back up the database file (or the
  whole `DATA_DIR`) on a schedule:
  ```bash
  tar czf /backups/hafiz-pos-$(date +%F).tar.gz -C /var/lib/hafiz-pos/data .
  ```
