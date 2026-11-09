const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const file = process.env.DB_PATH || './data/estate.db';
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);

db.exec(`
CREATE TABLE IF NOT EXISTS verified (
  user_id TEXT PRIMARY KEY, username TEXT, access_token TEXT, refresh_token TEXT,
  token_at INTEGER, verified_at INTEGER, dm_optout INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS servers (guild_id TEXT PRIMARY KEY, name TEXT, auto_join INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT, user_id TEXT, opened_at INTEGER, closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

db.getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
db.setSetting = (k, v) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v || '');

module.exports = db;
