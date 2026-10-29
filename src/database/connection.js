'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Adaptador mínimo para que node:sqlite (Node 22.5+) exponga la misma API que better-sqlite3.
class NodeSqliteAdapter {
  constructor(file) {
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(file);
    this.engine = 'node:sqlite';
  }
  prepare(sql) { return this.db.prepare(sql); }
  exec(sql) { this.db.exec(sql); }
  pragma(text) { this.db.exec(`PRAGMA ${text}`); }
  transaction(fn) {
    return (...args) => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        try { this.db.exec('ROLLBACK'); } catch { /* ya revertido */ }
        throw err;
      }
    };
  }
  close() { this.db.close(); }
}

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  let db;
  try {
    const Better = require('better-sqlite3');
    db = new Better(file);
    db.engine = 'better-sqlite3';
  } catch (firstError) {
    try {
      db = new NodeSqliteAdapter(file);
    } catch {
      throw new Error(
        'No se pudo abrir SQLite. Instala "better-sqlite3" (npm install) o usa Node.js 22.5 o superior. ' +
        `Detalle: ${firstError.message}`,
      );
    }
  }
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

module.exports = { openDatabase };
