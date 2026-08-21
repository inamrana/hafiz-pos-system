# Deploying Mart POS

Mart POS is a **multi-tenant hosted web app**: every shop that signs up shares one
database, with every table scoped by `shop_id`. Data access goes through
[`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts), which works
two ways:

- **Local file** (`file:...`) — zero setup, used automatically in dev and for
  self-hosted/offline deployments (VPS, Docker, Electron).
- **Turso** (remote libSQL over HTTP) — a hosted, SQLite-compatible database with a
  free tier. This is what makes **Vercel** (and other serverless platforms) work,
  since there's no local disk involved at all.

Pick whichever fits how you want to run this.

---

## Option A — Vercel + Turso (free, no server to manage)

### 1. Create a free Turso database

1. Sign up at [turso.tech](https://turso.tech) (no card required).
2. Install the CLI or use their web dashboard to create a database:
   ```bash
   turso db create mart-pos
   ```
3. Get the connection URL and an auth token:
   ```bash
   turso db show mart-pos --url
   turso db tokens create mart-pos
   ```

### 2. Deploy to Vercel

1. Import the GitHub repo into Vercel as a new project (framework preset: Next.js,
   auto-detected).
2. Add environment variables (**Project Settings → Environment Variables**):

   | Variable | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the URL from `turso db show` (starts with `libsql://`) |
   | `TURSO_AUTH_TOKEN` | the token from `turso db tokens create` |
   | `NODE_ENV` | `production` (Vercel usually sets this automatically) |

3. Deploy. The schema creates itself automatically on first request — no separate
   migration step.
4. Visit `https://<your-vercel-domain>/signup` to create the first shop.

That's it — no volumes, no Dockerfile, no server to patch. Turso's free tier has
real limits (storage, row reads/writes per month); check their current pricing
page before committing a lot of shops to it.

---

## Option B — Docker (self-hosted, works with or without Turso)

```bash
# Build and start (uses the local-file database by default)
docker compose up -d --build

curl -I http://localhost:3000/login
docker compose logs -f
```

Shop data lives in the `pos-data` named volume (`/app/data` in the container). To
use Turso instead of the local file even when self-hosting, just set
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` in `docker-compose.yml`'s `environment:`
block — the app picks whichever is configured automatically.

To back up the local-file volume:

```bash
docker run --rm -v hafiz-pos_pos-data:/data -v "$PWD/backup:/backup" \
  alpine tar czf /backup/pos-data-$(date +%F).tar.gz -C /data .
```

Put Docker behind a reverse proxy (Caddy or nginx) for HTTPS.

---

## Option C — Plain VPS (no Docker)

Requires Node.js 20+.

```bash
git clone <your-repo-url> mart-pos
cd mart-pos
npm ci
npm run build

# Local file (default) — set DATA_DIR to a persistent disk
DATA_DIR=/var/lib/mart-pos/data NODE_ENV=production PORT=3000 node .next/standalone/server.js

# Or against Turso instead — TURSO_DATABASE_URL takes priority over DATA_DIR
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... NODE_ENV=production PORT=3000 node .next/standalone/server.js
```

`output: 'standalone'` doesn't auto-copy static assets, so before running you must:

```bash
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

### Run it as a service (systemd)

`/etc/systemd/system/mart-pos.service`:

```ini
[Unit]
Description=Mart POS
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mart-pos/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/mart-pos/data
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=martpos

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/mart-pos/data && sudo chown martpos:martpos /var/lib/mart-pos/data
sudo systemctl enable --now mart-pos
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
| `NODE_ENV` | Recommended | — | Set to `production` — also makes the session cookie require HTTPS. |

No other secrets are required. The session-signing key is generated automatically
on first run and stored in the database itself (`platform_settings` table).

---

## First run

There's no seeded admin account — visit `/signup` to create the first shop. That
gives you a **Shop Code**; write it down, it's required (along with username +
password) for every login, including yours.

---

## Backups

- **Turso**: use `turso db shell mart-pos .dump` or Turso's built-in point-in-time
  recovery (check their current docs for retention on the free tier).
- **Local file / Docker / VPS**: back up the whole `DATA_DIR` on a schedule:
  ```bash
  tar czf /backups/mart-pos-$(date +%F).tar.gz -C /var/lib/mart-pos/data .
  ```

## Multi-tenancy & scaling notes

Every shop shares one database; isolation is enforced by a `shop_id` column on
every tenant-scoped table, checked in every single query. This is the standard
SaaS pattern and scales to many shops on Turso's free/paid tiers without any
per-shop provisioning. If you outgrow Turso specifically, the same `shop_id`
pattern maps cleanly onto Postgres/MySQL — swapping the driver is a much smaller
job than the original single-tenant → multi-tenant migration was.
