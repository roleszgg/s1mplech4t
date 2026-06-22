# Simple Chat App

A small real-time, one-on-one messaging app: sign up, log in, pick another
user from the sidebar, and chat live.

## Stack

- **Backend:** Node.js + Express (REST API for auth/history) + Socket.io (live messages)
- **Auth:** bcrypt-hashed passwords + JWT session tokens
- **Storage:** plain JSON files in `data/` (no database server or native
  compiler needed — `npm install` just works anywhere). Easy to swap for
  SQLite/Postgres later since `src/db.js` is the only file that touches storage.
- **Frontend:** vanilla HTML/CSS/JS, no framework/build step

## Getting started

```sh
npm install
cp .env.example .env   # then edit .env and set a real JWT_SECRET
npm start
```

Open `http://localhost:3000`, create an account, open the same URL in a
second browser (or incognito window), create a second account, and message
between them.

For development with auto-restart on file changes:

```sh
npm run dev
```

## Running the tests

```sh
npm test
```

This runs a real end-to-end check (not mocks): it boots the actual server,
registers two users, confirms the password is stored as a bcrypt hash (not
plaintext) on disk, logs in, sends a live message over a real Socket.io
connection, and confirms it was persisted and retrievable via the API.

## How passwords are protected

Passwords are **hashed with bcrypt**, not "encrypted." That distinction
matters:

- **Encryption** is reversible — whoever holds the key can recover the
  original data.
- **Hashing** (what this app does) is one-way. Even the server itself
  cannot turn a stored hash back into the original password. Each password
  is also individually salted, so two users with the same password get
  completely different stored hashes, and an attacker can't precompute one
  lookup table to crack every account in a leaked file at once.

So if `data/users.json` ever leaked, an attacker would see something like
`$2b$10$N9qo8uLOickgx2ZMRZoMy...` per user — not the actual password — and
would have to brute-force each hash individually, which bcrypt is
deliberately built to make slow.

## Security notes / things to harden before any real deployment

This was built to be genuinely functional and correctly handle passwords,
but it's still intentionally simple. Before using this for anything beyond
learning/demos, you'd want to add:

- **HTTPS** in front of it (e.g. via a reverse proxy) — without it, the
  JWT and messages travel in plaintext over the network.
- **Rate limiting** on `/api/login` and `/api/register` to slow down
  brute-force attempts.
- A **real database** instead of JSON files once you have concurrent
  writes/more than a handful of users.
- **Token revocation** — JWTs here are valid for 7 days with no way to
  invalidate one early (e.g. on logout) short of changing `JWT_SECRET`,
  which invalidates *everyone's* session.
- Stronger **username/password policy** if needed (currently: usernames
  3-20 chars alphanumeric/underscore, passwords 6+ chars).

## Project structure

```
src/
  server.js   — Express app, REST routes, Socket.io wiring
  auth.js     — bcrypt hashing + JWT sign/verify
  db.js       — JSON-file storage for users & messages
public/
  index.html, style.css, app.js  — frontend
test/
  e2e.test.js — real end-to-end smoke test (no mocks)
```
