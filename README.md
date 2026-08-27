# BizSuite

A generic, multi-tenant business management platform: stock/inventory, clients,
quotes, orders (job/project timelines with delivery-extension requests),
deliveries, invoicing & billing, client emailing, and BI-style performance
reports (today / week / month / quarter / year).

Built by Gilded Age Consulting as a white-label-ready base to offer to
multiple client businesses across different industries — each business signs
up as its own isolated tenant (own login, own data; nobody sees another
tenant's clients, stock, invoices, etc).

## Stack

- Node.js + Express, server-rendered with EJS (no separate frontend build)
- SQLite via Node's built-in `node:sqlite` module — no native dependencies,
  no external database service to set up
- JWT-in-cookie auth, tenant-scoped on every query
- Pluggable client-emailing: works out of the box in "preview" mode (emails
  are logged, not actually sent) until real SMTP credentials are configured

## Local setup

```
npm install
cp .env.example .env   # edit JWT_SECRET etc.
npm run seed            # optional: creates a demo tenant with sample data
npm start
```

Then visit http://localhost:3000. Demo login (after seeding):
`demo@bizsuite.app` / `demo1234`.

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path, e.g. `file:./data/prod.db` |
| `JWT_SECRET` | Required. Long random string signing login sessions. |
| `PORT` | Defaults to 3000. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional. If unset, quote/invoice emails are logged as previews instead of sent. |

## Data model

One tenant (business) per signup. Every table is scoped by `tenant_id` and
every query in `src/routes/*.js` filters by it — this is what keeps one
business's data invisible to another.

Core flow: Client → Quote → (convert) → Order/Job → Delivery + Invoice →
Payment. Stock items can be attached to quote/order/invoice line items and
have their own in/out/adjust movement ledger.

## Deployment note: persistent storage

This app stores data in a SQLite file on local disk. On Render's free web
service tier, local disk is **not persistent** — it's wiped on every
restart/redeploy. For a permanent deployment, attach a paid-plan persistent
disk (Render dashboard → your service → Disks) and point `DATABASE_URL` at a
path under that disk's mount point. See `render.yaml` for the exact settings.

## What's deliberately simple (prototype scope)

- Single user role per business is treated the same regardless of
  OWNER/ADMIN/STAFF (the role column exists for future permission tiers but
  isn't enforced differently yet).
- Stock is not auto-decremented when a quote converts to an order — stock
  movements are recorded explicitly (received / used / adjustment) so the
  ledger reflects real-world events rather than assumptions.
- No password-reset flow yet (change a password by asking whoever built this
  to reset it directly in the database, or extend the auth routes).
- One currency and one tax rate per tenant (set in Settings), not per line
  item.
