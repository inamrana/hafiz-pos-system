# Deploying Mart POS

Mart POS is a **multi-tenant hosted web app**: every shop that signs up gets its own
SQLite database file under `DATA_DIR`. That means it needs a server with a real,
persistent disk — **it will not work on Vercel or other serverless platforms**,
since their filesystems are ephemeral (wiped between requests/deploys) and per-shop
data would vanish or corrupt under concurrent invocations.

You need one of:
- A VPS (DigitalOcean, Linode, Hetzner, AWS EC2, etc.), or
- A Docker-friendly host with persistent volumes (Railway, Render, Fly.io, a VPS with Docker)

---

## Option A — Docker (recommended)

```bash
# Build and start
docker compose up -d --build

# Check it's running
curl -I http://localhost:3000/login

# View logs
docker compose logs -f

# Update after pulling new code
docker compose up -d --build
```

Shop data lives in the `pos-data` named volume (mounted at `/app/data` in the
container) and survives rebuilds. To inspect or back it up:

```bash
docker run --rm -v hafiz-pos_pos-data:/data -v "$PWD/backup:/backup" \
  alpine tar czf /backup/pos-data-$(date +%F).tar.gz -C /data .
```

Put Docker behind a reverse proxy (Caddy or nginx) for HTTPS — see below.

> I built and smoke-tested the production build this Dockerfile runs (`next build` →
> standalone output → `node server.js`, with signup/login/dashboard all verified
> working end-to-end), but Docker itself isn't installed on this machine, so the
> image build hasn't been run here. Do a `docker compose up -d --build` and confirm
> before relying on it.

---

## Option B — Plain VPS (no Docker)

Requires Node.js 20+ on the server.

```bash
git clone <your-repo-url> mart-pos
cd mart-pos
npm ci
npm run build

DATA_DIR=/var/lib/mart-pos/data NODE_ENV=production PORT=3000 node .next/standalone/server.js
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

Or nginx + certbot if you already run nginx.

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATA_DIR` | Recommended | `./data` | Where `platform.db` and per-shop databases live. Point this at a persistent, non-network-mounted disk (SQLite's WAL mode doesn't play well with NFS). |
| `PORT` | No | `3000` | Port the Node server listens on. |
| `NODE_ENV` | Recommended | — | Set to `production` — this also makes the session cookie require HTTPS. |

No other secrets are required. The session-signing key is generated automatically
on first run and stored in `platform.db`.

---

## First run

There's no seeded admin account — visit `/signup` to create the first shop. That
gives you a **Shop Code**; write it down, it's required (along with username +
password) for every login, including yours.

---

## Backups

Everything that matters is under `DATA_DIR`: `platform.db` (the shop registry) and
`shops/*.db` (one file per shop). Back this whole directory up on a schedule —
a nightly cron job is enough for most shops:

```bash
tar czf /backups/mart-pos-$(date +%F).tar.gz -C /var/lib/mart-pos/data .
```

## Scaling notes

This is a single-node SQLite setup — great for a handful to a few dozen shops on
one box, but it doesn't horizontally scale across multiple app servers (each
server would need its own copy of `DATA_DIR`, and they'd drift). If you outgrow
that, the natural next step is migrating to a shared Postgres/MySQL instance —
worth a dedicated pass if/when you get there rather than guessing at it now.
