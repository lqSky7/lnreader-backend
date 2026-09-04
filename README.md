# LNReader Sync Backend

Small Express + Better Auth + Prisma/Postgres backend for LNReader account sync.

## Features

- Better Auth email/password auth with username support
- Password reset via deep link (`lnreader://reset-password`)
- `GET /api/sync` returns the signed-in user and their synced payload
- `PUT /api/sync` stores profile, non-local library books, and installed source metadata
  - Optional `clientUpdatedAt` enables conflict detection: stale writes get HTTP 409
    with the current server copy instead of silently clobbering newer data
- `GET /api/sync/meta` returns just `{ updatedAt }` for cheap change polling
- `GET /api/sync/export` downloads the payload as a backup JSON attachment
- `DELETE /api/account` deletes the account (password confirmation; cascades to
  sessions and sync data)
- `GET /health` checks the database too (`503` when Postgres is unreachable)
- Auth endpoints are rate-limited; all errors are JSON (never HTML stack traces)
- Request logging, graceful shutdown, fail-fast config validation

## Local Setup

You need Node 20+ and a Postgres database.

```sh
cp .env.example .env   # then fill in DATABASE_URL + BETTER_AUTH_SECRET
npm install
npm run prisma:generate
npm run prisma:deploy  # applies prisma/migrations (required before first boot)
npm start
```

The iOS app defaults to `http://localhost:3005`. For a physical device, use your Mac's LAN IP in the login sheet.

Password reset emails are logged to the backend console until an email provider is wired in `src/email.ts`.

### Important: URL alignment

`BETTER_AUTH_URL` **must** equal the public host the app calls (e.g.
`https://lnreader-sync-sky788.azurewebsites.net` in production). Session
cookies and auth origin checks depend on it — a mismatch breaks sign-out and
cookie-authenticated requests with no obvious error.

## Tests

Tests need a **throwaway** Postgres database (they truncate all tables):

```sh
createdb lnreader_test
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/lnreader_test" npm test
```

This runs type-stripped integration tests (`node --test`) covering health,
error shapes, the full auth lifecycle (including the iOS deep-link reset
flow), sync round-trips in the exact iOS payload shape, conflict handling,
account deletion, rate limiting, and config/rate-limit units.

`npm run build` typechecks both `src` and `tests`. Backend CI
(`.github/workflows/backend-ci.yml`) runs migrations + typecheck + tests on
every push/PR.

## Deploy notes (Azure)

- The container runs `prisma migrate deploy` on startup, so fresh databases
  get their tables automatically. Never delete files from `prisma/migrations/`
  (an empty migration folder breaks `migrate deploy` with P3015).
- Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (matching the
  public host!), and `CLIENT_ORIGIN` in App Service settings.
