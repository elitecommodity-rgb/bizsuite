// Thin data-access layer on top of Node's built-in node:sqlite module.
// Deliberately dependency-free for the database itself (no native module
// downloads, no external DB service) — a single file on a persistent disk.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const rawUrl = process.env.DATABASE_URL || 'file:./data/dev.db';
const dbPath = rawUrl.startsWith('file:') ? rawUrl.slice(5) : rawUrl;
const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new DatabaseSync(resolvedPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function newId(prefix) {
  const rand = crypto.randomBytes(9).toString('base64url');
  return prefix ? `${prefix}_${rand}` : rand;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params) || null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, run, get, all, transaction, newId, dbPath: resolvedPath };
