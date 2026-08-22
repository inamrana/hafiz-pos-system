# Hafiz Stationers POS

A single-user point-of-sale app for one shop — billing, stock/inventory with
batches & expiry tracking, purchases, suppliers with a payables ledger,
customers with an udhaar (credit) ledger, returns, and daily/monthly/yearly
reports. No login, no signup, no multi-tenancy — it's just for you.

Runs as:
- a local Next.js dev/prod server,
- an Electron desktop app (Windows installer via `electron-builder`),
- or a hosted web app on Vercel (using [Turso](https://turso.tech) for the database).

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Desktop app

```bash
npm run electron:dev   # dev mode
npm run electron:pack  # build a Windows installer into dist/
```

## Deploying

See [DEPLOY.md](./DEPLOY.md) for Vercel+Turso, Docker, and VPS options.
