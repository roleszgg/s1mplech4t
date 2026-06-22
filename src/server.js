/*
 * server.js — entry point.
 *
 * REST API:
 *   POST /api/register   { username, password }
 *   POST /api/login      { username, password }  -> { token, username }
 *   GET  /api/users                                (auth) -> [{ username }]
 *   GET  /api/messages/:withUsername                (auth) -> conversation history
 *
 * Real-time:
 *   Socket.io, authenticated via `socket.handshake.auth.token` (the
 *   same JWT issued at login). Event 'private_message' sends a message
 *   to another user; 'private_message' is also what's received.
 */

require("dotenv").config({ quiet: true });

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./db");
const { hashPassword, verifyPassword, signToken, verifyToken, requireAuth } = require("./auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

/* ---------------- validation helpers ---------------- */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validateCredentials(username, password) {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return "Username must be 3-20 characters: letters, numbers, underscores only.";
  }
  if (typeof password !== "string" || password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  return null;
}

/* ---------------- REST API ---------------- */

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body || {};

  const validationError = validateCredentials(username, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: "That username is already taken." });
  }

  const passwordHash = await hashPassword(password);
  const user = db.createUser({ username, passwordHash });

  const token = signToken(user);
  res.status(201).json({ token, username: user.username });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = db.findUserByUsername(username);
  // Same error message whether the username doesn't exist or the password
  // is wrong — don't leak which one it was.
  const invalidMsg = { error: "Invalid username or password." };

  if (!user) return res.status(401).json(invalidMsg);

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) return res.status(401).json(invalidMsg);

  const token = signToken(user);
  res.json({ token, username: user.username });
});

app.get("/api/users", requireAuth, (req, res) => {
  const others = db
    .getUsers()
    .filter((u) => u.username !== req.user.username)
    .map((u) => ({ username: u.username }));
  res.json(others);
});

app.get("/api/messages/:withUsername", requireAuth, (req, res) => {
  const me = db.findUserByUsername(req.user.username);
  const other = db.findUserByUsername(req.params.withUsername);

  if (!other) return res.status(404).json({ error: "User not found." });

  const conversation = db.getConversation(me.id, other.id).map((m) => ({
    from: m.senderId === me.id ? me.username : other.username,
    to: m.receiverId === me.id ? me.username : other.username,
    content: m.content,
    createdAt: m.createdAt,
  }));

  res.json(conversation);
});

/* ---------------- Socket.io (real-time) ---------------- */

// username -> socket.id, for routing live messages to whoever's online
const onlineUsers = new Map();

io.use((socket, next) => {
  try {
    const { token } = socket.handshake.auth || {};
    if (!token) throw new Error("No token provided");
    socket.user = verifyToken(token); // { sub, username }
    next();
  } catch (err) {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const { username } = socket.user;
  onlineUsers.set(username, socket.id);
  io.emit("presence", { username, online: true });

  socket.on("private_message", ({ to, content }) => {
    if (typeof to !== "string" || typeof content !== "string" || !content.trim()) {
      return; // silently drop malformed events
    }

    const sender = db.findUserByUsername(username);
    const receiver = db.findUserByUsername(to);
    if (!sender || !receiver) return;

    const saved = db.addMessage({
      senderId: sender.id,
      receiverId: receiver.id,
      content: content.trim(),
    });

    const payload = {
      from: sender.username,
      to: receiver.username,
      content: saved.content,
      createdAt: saved.createdAt,
    };

    // Echo back to sender (so their own UI updates) ...
    socket.emit("private_message", payload);

    // ... and forward to the recipient if they're currently connected.
    const receiverSocketId = onlineUsers.get(receiver.username);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("private_message", payload);
    }
  });

  socket.on("disconnect", () => {
    if (onlineUsers.get(username) === socket.id) {
      onlineUsers.delete(username);
      io.emit("presence", { username, online: false });
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Chat app listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io };
