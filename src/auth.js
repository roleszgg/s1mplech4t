/*
 * auth.js - password hashing + JWT helpers.
 *
 * IMPORTANT TERMINOLOGY NOTE:
 * Passwords are HASHED (bcrypt), not "encrypted". Encryption is
 * reversible (you can decrypt it back); hashing is one-way. We never
 * want to be able to recover a user's plaintext password, even as the
 * server operator - bcrypt.hash() is deliberately one-way and salted,
 * so even if the data file leaks, an attacker can't simply read the
 * passwords back out, and can't easily run a single rainbow-table
 * attack against every user at once (salting prevents that).
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SALT_ROUNDS = 10;

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required. Copy .env.example to .env and set a long random secret.");
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d";

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function verifyToken(token) {
  // Throws if invalid/expired - callers should try/catch this.
  return jwt.verify(token, JWT_SECRET);
}

/* Express middleware: requires `Authorization: Bearer <token>` */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  JWT_SECRET,
};
