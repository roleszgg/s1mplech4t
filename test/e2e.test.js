/*
 * test/e2e.test.js — a real end-to-end smoke test, not a mock.
 * Spins up the actual server, registers two real users, logs them in,
 * sends a live message over an actual Socket.io connection, and checks
 * it was persisted and retrievable via the REST API. Exits non-zero on
 * any failure so it's CI-friendly.
 */

const fs = require("fs");
const path = require("path");

// Use an isolated data dir so this test never touches real user data.
const TEST_DATA_DIR = path.join(__dirname, "tmp-data");
process.env.JWT_SECRET = "test-secret";
process.env.PORT = "0"; // ask the OS for a free port

function resetTestData() {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

// Point db.js at a throwaway directory by monkeypatching before require.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request, ...args);
};

resetTestData();
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

// db.js resolves its data dir relative to __dirname (../data). Easiest
// reliable override for a smoke test: symlink data -> tmp-data isn't
// portable, so instead just clear the real data files before/after and
// restore them. This keeps db.js untouched and dependency-free.
const REAL_DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(REAL_DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(REAL_DATA_DIR, "messages.json");
const BACKUP_SUFFIX = ".e2e-backup";

function backupRealData() {
  for (const f of [USERS_FILE, MESSAGES_FILE]) {
    if (fs.existsSync(f)) fs.renameSync(f, f + BACKUP_SUFFIX);
  }
}

function restoreRealData() {
  for (const f of [USERS_FILE, MESSAGES_FILE]) {
    fs.rmSync(f, { force: true });
    if (fs.existsSync(f + BACKUP_SUFFIX)) fs.renameSync(f + BACKUP_SUFFIX, f);
  }
}

let failed = false;
function assert(condition, message) {
  if (!condition) {
    failed = true;
    console.error(`✗ FAIL: ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

async function main() {
  backupRealData();

  const { server } = require("../src/server");
  const fetch = (await import("node-fetch")).default;
  const { io: ioClient } = require("socket.io-client");

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  try {
    // 1) Register two users
    const aliceReg = await fetch(`${base}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice_test", password: "correct-horse" }),
    }).then((r) => r.json());
    assert(!!aliceReg.token, "register alice -> got a token");

    const bobReg = await fetch(`${base}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob_test", password: "battery-staple" }),
    }).then((r) => r.json());
    assert(!!bobReg.token, "register bob -> got a token");

    // 1b) Duplicate username should be rejected
    const dupeReg = await fetch(`${base}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice_test", password: "whatever123" }),
    });
    assert(dupeReg.status === 409, "duplicate username registration is rejected (409)");

    // 2) Password is actually hashed on disk, not stored in plaintext
    const usersOnDisk = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    const aliceOnDisk = usersOnDisk.find((u) => u.username === "alice_test");
    assert(
      aliceOnDisk.passwordHash !== "correct-horse" && aliceOnDisk.passwordHash.startsWith("$2"),
      "password on disk is a bcrypt hash, not the plaintext password"
    );

    // 3) Login with correct password works, wrong password fails
    const aliceLogin = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice_test", password: "correct-horse" }),
    }).then((r) => r.json());
    assert(!!aliceLogin.token, "login with correct password succeeds");

    const badLogin = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice_test", password: "wrong-password" }),
    });
    assert(badLogin.status === 401, "login with wrong password is rejected (401)");

    // 4) Unauthenticated API access is rejected
    const noAuth = await fetch(`${base}/api/users`);
    assert(noAuth.status === 401, "GET /api/users without a token is rejected (401)");

    // 5) Real-time message over an actual socket connection
    const aliceSocket = ioClient(base, { auth: { token: aliceReg.token } });
    const bobSocket = ioClient(base, { auth: { token: bobReg.token } });

    const bobReceived = new Promise((resolve) => {
      bobSocket.on("private_message", (msg) => resolve(msg));
    });

    await new Promise((resolve) => aliceSocket.on("connect", resolve));
    await new Promise((resolve) => bobSocket.on("connect", resolve));

    aliceSocket.emit("private_message", { to: "bob_test", content: "hello bob, this is alice" });

    const received = await Promise.race([
      bobReceived,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);

    assert(received.content === "hello bob, this is alice", "bob receives alice's live message via socket");
    assert(received.from === "alice_test", "received message correctly attributed to alice");

    aliceSocket.disconnect();
    bobSocket.disconnect();

    // 6) Message was persisted and is retrievable via REST history
    const history = await fetch(`${base}/api/messages/alice_test`, {
      headers: { Authorization: `Bearer ${bobReg.token}` },
    }).then((r) => r.json());

    assert(
      history.some((m) => m.content === "hello bob, this is alice"),
      "message persisted and retrievable via GET /api/messages/:withUsername"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreRealData();
  }

  if (failed) {
    console.error("\nSome checks FAILED.");
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test crashed:", err);
  restoreRealData();
  process.exit(1);
});
