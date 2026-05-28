# LNReader Sync Backend

Small Express + Better Auth + Prisma/Postgres backend for LNReader account sync.

## Features

- Better Auth email/password auth with username support
- Password reset request/reset endpoints through Better Auth
- `GET /api/sync` returns the signed-in user and their synced payload
- `PUT /api/sync` stores profile, non-local library books, and installed source metadata

## Local Setup

```sh
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:deploy
npm start
```

The iOS app defaults to `http://localhost:3005`. For a physical device, use your Mac's LAN IP in the login sheet.

Password reset emails are logged to the backend console until an email provider is wired in `src/email.ts`.
