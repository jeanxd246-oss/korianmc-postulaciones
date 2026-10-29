'use strict';

// Cada elemento es una migración. NUNCA edites una migración ya publicada: añade una nueva al final.
const MIGRATIONS = [
  // v1: esquema inicial
  (db) => {
    db.exec(`
      CREATE TABLE guild_config (
        guild_id TEXT PRIMARY KEY,
        panel_channel_id TEXT,
        panel_message_id TEXT,
        category_id TEXT,
        log_channel_id TEXT,
        review_channel_id TEXT,
        reviewer_roles TEXT NOT NULL DEFAULT '[]',
        admin_roles TEXT NOT NULL DEFAULT '[]',
        close_delete_seconds INTEGER NOT NULL DEFAULT 0,
        dm_notifications INTEGER NOT NULL DEFAULT 1,
        ping_reviewers INTEGER NOT NULL DEFAULT 1,
        texts TEXT NOT NULL DEFAULT '{}',
        questions_seeded INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        key TEXT,
        label TEXT NOT NULL,
        text TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        max_length INTEGER NOT NULL DEFAULT 1000
      );
      CREATE INDEX idx_questions_guild ON questions (guild_id, position);

      CREATE TABLE requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX idx_requirements_guild ON requirements (guild_id, position);

      CREATE TABLE applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        channel_id TEXT,
        dossier_channel_id TEXT,
        dossier_message_id TEXT,
        status TEXT NOT NULL,
        mc_username TEXT,
        discord_username TEXT,
        created_at INTEGER NOT NULL,
        submitted_at INTEGER,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolution_reason TEXT,
        closed_at INTEGER,
        delete_at INTEGER,
        UNIQUE (guild_id, number)
      );
      CREATE UNIQUE INDEX idx_applications_one_active
        ON applications (guild_id, user_id)
        WHERE status IN ('preparacion','enviada','revision','info_solicitada');
      CREATE INDEX idx_applications_status ON applications (guild_id, status);
      CREATE INDEX idx_applications_user ON applications (guild_id, user_id);
      CREATE INDEX idx_applications_channel ON applications (channel_id);

      CREATE TABLE answers (
        application_id INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        question_id INTEGER,
        key TEXT,
        label TEXT NOT NULL,
        question_text TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        max_length INTEGER NOT NULL DEFAULT 1000,
        answer TEXT,
        answered_at INTEGER,
        PRIMARY KEY (application_id, position)
      );

      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_notes_app ON notes (application_id);

      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        application_id INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_history_app ON history (application_id);
      CREATE INDEX idx_history_actor ON history (actor_id);
    `);
  },
];

function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version);
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.transaction(() => {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return MIGRATIONS.length;
}

module.exports = { migrate, MIGRATIONS };
