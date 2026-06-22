/*
 * db.js — minimal file-based storage for users and messages.
 *
 * This intentionally avoids a "real" database (no native compiler,
 * no server process) so `npm install` + `npm start` just works on any
 * machine. It's synchronous and fine for a small/simple app; if this
 * ever needs to handle real concurrent load, swap this module out for
 * SQLite/Postgres and keep the same function signatures.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]", "utf8");
  if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, "[]", "utf8");
}

function readJSON(file) {
  ensureDataFiles();
  const raw = fs.readFileSync(file, "utf8");
  return raw.trim() ? JSON.parse(raw) : [];
}

function writeJSON(file, data) {
  // Write to a temp file then rename, so a crash mid-write can't corrupt the file.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/* ---------------- users ---------------- */

function getUsers() {
  return readJSON(USERS_FILE);
}

function findUserByUsername(username) {
  const lower = username.toLowerCase();
  return getUsers().find((u) => u.username.toLowerCase() === lower) || null;
}

function findUserById(id) {
  return getUsers().find((u) => u.id === id) || null;
}

function createUser({ username, passwordHash }) {
  const users = getUsers();
  const nextId = users.length > 0 ? Math.max(...users.map((u) => u.id)) + 1 : 1;
  const user = {
    id: nextId,
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeJSON(USERS_FILE, users);
  return user;
}

/* ---------------- messages ---------------- */

function getMessages() {
  return readJSON(MESSAGES_FILE);
}

function getConversation(userIdA, userIdB) {
  return getMessages()
    .filter(
      (m) =>
        (m.senderId === userIdA && m.receiverId === userIdB) ||
        (m.senderId === userIdB && m.receiverId === userIdA)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function addMessage({ senderId, receiverId, content }) {
  const messages = getMessages();
  const nextId = messages.length > 0 ? Math.max(...messages.map((m) => m.id)) + 1 : 1;
  const message = {
    id: nextId,
    senderId,
    receiverId,
    content,
    createdAt: new Date().toISOString(),
  };
  messages.push(message);
  writeJSON(MESSAGES_FILE, messages);
  return message;
}

module.exports = {
  getUsers,
  findUserByUsername,
  findUserById,
  createUser,
  getConversation,
  addMessage,
};
