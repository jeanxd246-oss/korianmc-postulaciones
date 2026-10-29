'use strict';

const { ACTIVE_STATUSES, TRANSITIONS, DEFAULT_QUESTIONS } = require('../config/constants');

class StateError extends Error {
  constructor(code, detail) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'StateError';
    this.code = code; // NOT_FOUND | CONFLICT | INVALID | ALREADY | NO_QUESTIONS | DUPLICATE
    this.detail = detail;
  }
}

function safeJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function placeholders(list) {
  return list.map(() => '?').join(',');
}

function createRepo(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const run = (sql, ...p) => stmt(sql).run(...p);
  const get = (sql, ...p) => stmt(sql).get(...p);
  const all = (sql, ...p) => stmt(sql).all(...p);
  const tx = (fn) => db.transaction(fn)();
  const now = () => Date.now();

  // ───────────── Configuración por servidor ─────────────
  function parseConfig(row) {
    if (!row) return null;
    return {
      ...row,
      reviewer_roles: safeJson(row.reviewer_roles, []),
      admin_roles: safeJson(row.admin_roles, []),
      texts: safeJson(row.texts, {}),
      dm_notifications: !!row.dm_notifications,
      ping_reviewers: !!row.ping_reviewers,
    };
  }

  function getConfig(guildId) {
    return parseConfig(get('SELECT * FROM guild_config WHERE guild_id = ?', guildId));
  }

  function insertDefaultQuestions(guildId) {
    DEFAULT_QUESTIONS.forEach((q, i) => {
      run(
        'INSERT INTO questions (guild_id, position, key, label, text, required, max_length) VALUES (?,?,?,?,?,?,?)',
        guildId, i + 1, q.key, q.label, q.text, q.required, q.max_length,
      );
    });
  }

  function ensureGuild(guildId) {
    const existing = getConfig(guildId);
    if (existing && existing.questions_seeded) return existing;
    tx(() => {
      const t = now();
      run('INSERT OR IGNORE INTO guild_config (guild_id, created_at, updated_at) VALUES (?,?,?)', guildId, t, t);
      const row = get('SELECT questions_seeded FROM guild_config WHERE guild_id = ?', guildId);
      if (!row.questions_seeded) {
        const has = get('SELECT COUNT(*) AS c FROM questions WHERE guild_id = ?', guildId).c;
        if (!has) insertDefaultQuestions(guildId);
        run('UPDATE guild_config SET questions_seeded = 1, updated_at = ? WHERE guild_id = ?', t, guildId);
      }
    });
    return getConfig(guildId);
  }

  const CONFIG_COLUMNS = new Set([
    'panel_channel_id', 'panel_message_id', 'category_id', 'log_channel_id', 'review_channel_id',
    'reviewer_roles', 'admin_roles', 'close_delete_seconds', 'dm_notifications', 'ping_reviewers', 'texts',
  ]);

  function updateConfig(guildId, patch) {
    ensureGuild(guildId);
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!CONFIG_COLUMNS.has(k)) throw new Error(`Columna de configuración no permitida: ${k}`);
      sets.push(`${k} = ?`);
      if (['reviewer_roles', 'admin_roles', 'texts'].includes(k)) vals.push(JSON.stringify(v));
      else if (typeof v === 'boolean') vals.push(v ? 1 : 0);
      else vals.push(v ?? null);
    }
    if (!sets.length) return getConfig(guildId);
    sets.push('updated_at = ?');
    vals.push(now(), guildId);
    db.prepare(`UPDATE guild_config SET ${sets.join(', ')} WHERE guild_id = ?`).run(...vals);
    return getConfig(guildId);
  }

  // ───────────── Preguntas ─────────────
  const listQuestions = (guildId) =>
    all('SELECT * FROM questions WHERE guild_id = ? ORDER BY position ASC', guildId);

  function addQuestion(guildId, q) {
    return tx(() => {
      const pos = get('SELECT COALESCE(MAX(position),0) AS m FROM questions WHERE guild_id = ?', guildId).m + 1;
      const r = run(
        'INSERT INTO questions (guild_id, position, key, label, text, required, max_length) VALUES (?,?,?,?,?,?,?)',
        guildId, pos, q.key ?? null, q.label, q.text, q.required ? 1 : 0, q.max_length,
      );
      return get('SELECT * FROM questions WHERE id = ?', Number(r.lastInsertRowid));
    });
  }

  function updateQuestion(guildId, position, patch) {
    const cur = get('SELECT * FROM questions WHERE guild_id = ? AND position = ?', guildId, position);
    if (!cur) throw new StateError('NOT_FOUND', 'pregunta');
    const next = {
      label: patch.label ?? cur.label,
      text: patch.text ?? cur.text,
      required: patch.required === undefined || patch.required === null ? cur.required : (patch.required ? 1 : 0),
      max_length: patch.max_length ?? cur.max_length,
    };
    run('UPDATE questions SET label=?, text=?, required=?, max_length=? WHERE id=?',
      next.label, next.text, next.required, next.max_length, cur.id);
    return get('SELECT * FROM questions WHERE id = ?', cur.id);
  }

  function deleteQuestion(guildId, position) {
    return tx(() => {
      const cur = get('SELECT * FROM questions WHERE guild_id = ? AND position = ?', guildId, position);
      if (!cur) throw new StateError('NOT_FOUND', 'pregunta');
      run('DELETE FROM questions WHERE id = ?', cur.id);
      run('UPDATE questions SET position = position - 1 WHERE guild_id = ? AND position > ?', guildId, position);
      return cur;
    });
  }

  function moveQuestion(guildId, from, to) {
    return tx(() => {
      const list = listQuestions(guildId);
      if (from < 1 || from > list.length || to < 1 || to > list.length) throw new StateError('INVALID', 'posición');
      const [item] = list.splice(from - 1, 1);
      list.splice(to - 1, 0, item);
      list.forEach((q, i) => run('UPDATE questions SET position = ? WHERE id = ?', i + 1, q.id));
      return item;
    });
  }

  function resetQuestions(guildId) {
    tx(() => {
      run('DELETE FROM questions WHERE guild_id = ?', guildId);
      insertDefaultQuestions(guildId);
    });
    return listQuestions(guildId);
  }

  // ───────────── Requisitos ─────────────
  const listRequirements = (guildId) =>
    all('SELECT * FROM requirements WHERE guild_id = ? ORDER BY position ASC', guildId);

  function addRequirement(guildId, text) {
    return tx(() => {
      const pos = get('SELECT COALESCE(MAX(position),0) AS m FROM requirements WHERE guild_id = ?', guildId).m + 1;
      const r = run('INSERT INTO requirements (guild_id, position, text) VALUES (?,?,?)', guildId, pos, text);
      return get('SELECT * FROM requirements WHERE id = ?', Number(r.lastInsertRowid));
    });
  }

  function updateRequirement(guildId, position, text) {
    const cur = get('SELECT * FROM requirements WHERE guild_id = ? AND position = ?', guildId, position);
    if (!cur) throw new StateError('NOT_FOUND', 'requisito');
    run('UPDATE requirements SET text = ? WHERE id = ?', text, cur.id);
    return get('SELECT * FROM requirements WHERE id = ?', cur.id);
  }

  function deleteRequirement(guildId, position) {
    return tx(() => {
      const cur = get('SELECT * FROM requirements WHERE guild_id = ? AND position = ?', guildId, position);
      if (!cur) throw new StateError('NOT_FOUND', 'requisito');
      run('DELETE FROM requirements WHERE id = ?', cur.id);
      run('UPDATE requirements SET position = position - 1 WHERE guild_id = ? AND position > ?', guildId, position);
      return cur;
    });
  }

  // ───────────── Postulaciones ─────────────
  const getApplication = (id) => get('SELECT * FROM applications WHERE id = ?', id) || null;
  const getByNumber = (guildId, number) =>
    get('SELECT * FROM applications WHERE guild_id = ? AND number = ?', guildId, number) || null;
  const getByChannel = (channelId) =>
    get('SELECT * FROM applications WHERE channel_id = ?', channelId) || null;
  const getActiveByUser = (guildId, userId) =>
    get(
      `SELECT * FROM applications WHERE guild_id = ? AND user_id = ? AND status IN (${placeholders(ACTIVE_STATUSES)})`,
      guildId, userId, ...ACTIVE_STATUSES,
    ) || null;

  function createApplication(guildId, userId, discordUsername) {
    try {
      return tx(() => {
        const questions = listQuestions(guildId);
        if (!questions.length) throw new StateError('NO_QUESTIONS');
        const number = get('SELECT COALESCE(MAX(number),0) AS n FROM applications WHERE guild_id = ?', guildId).n + 1;
        const t = now();
        const r = run(
          'INSERT INTO applications (guild_id, number, user_id, status, discord_username, created_at) VALUES (?,?,?,?,?,?)',
          guildId, number, userId, 'preparacion', discordUsername ?? null, t,
        );
        const id = Number(r.lastInsertRowid);
        questions.forEach((q, i) => {
          run(
            `INSERT INTO answers (application_id, position, question_id, key, label, question_text, required, max_length)
             VALUES (?,?,?,?,?,?,?,?)`,
            id, i + 1, q.id, q.key, q.label, q.text, q.required, q.max_length,
          );
        });
        run('INSERT INTO history (application_id, from_status, to_status, actor_id, reason, created_at) VALUES (?,?,?,?,?,?)',
          id, null, 'preparacion', userId, 'Postulación iniciada', t);
        return getApplication(id);
      });
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err.message))) throw new StateError('DUPLICATE');
      throw err;
    }
  }

  function deleteApplication(id) {
    run('DELETE FROM applications WHERE id = ?', id);
  }

  function setChannel(id, channelId) {
    run('UPDATE applications SET channel_id = ? WHERE id = ?', channelId, id);
  }

  function clearChannel(id) {
    run('UPDATE applications SET channel_id = NULL, delete_at = NULL WHERE id = ?', id);
  }

  function setDossier(id, channelId, messageId) {
    run('UPDATE applications SET dossier_channel_id = ?, dossier_message_id = ? WHERE id = ?', channelId, messageId, id);
  }

  function setDeleteAt(id, ms) {
    run('UPDATE applications SET delete_at = ? WHERE id = ?', ms ?? null, id);
  }

  // Cambio de estado atómico con comprobación del estado de origen (protege contra botones antiguos y carreras).
  function transition(id, from, to, actorId, reason = null) {
    return tx(() => {
      const app = getApplication(id);
      if (!app) throw new StateError('NOT_FOUND');
      const allowedFrom = Array.isArray(from) ? from : [from];
      if (!allowedFrom.includes(app.status)) throw new StateError('CONFLICT', app.status);
      if (!(TRANSITIONS[app.status] || []).includes(to)) throw new StateError('INVALID', `${app.status} -> ${to}`);
      const t = now();
      const sets = ['status = ?'];
      const vals = [to];
      if (to === 'enviada' && !app.submitted_at) { sets.push('submitted_at = ?'); vals.push(t); }
      if (to === 'aceptada' || to === 'rechazada') {
        sets.push('resolved_at = ?', 'resolved_by = ?', 'resolution_reason = ?');
        vals.push(t, actorId, reason);
      }
      if (to === 'cerrada') { sets.push('closed_at = ?'); vals.push(t); }
      if (['aceptada', 'rechazada', 'cerrada'].includes(app.status) && to !== 'cerrada') {
        // reapertura
        sets.push('resolved_at = NULL', 'resolved_by = NULL', 'resolution_reason = NULL', 'closed_at = NULL', 'delete_at = NULL');
      }
      vals.push(id);
      try {
        db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      } catch (err) {
        if (/UNIQUE constraint failed/i.test(String(err.message))) throw new StateError('DUPLICATE');
        throw err;
      }
      run('INSERT INTO history (application_id, from_status, to_status, actor_id, reason, created_at) VALUES (?,?,?,?,?,?)',
        id, app.status, to, actorId, reason, t);
      return getApplication(id);
    });
  }

  // ───────────── Respuestas ─────────────
  const getAnswers = (appId) =>
    all('SELECT * FROM answers WHERE application_id = ? ORDER BY position ASC', appId);

  function saveAnswer(appId, position, answer) {
    return tx(() => {
      const app = getApplication(appId);
      if (!app) throw new StateError('NOT_FOUND');
      if (app.status !== 'preparacion') throw new StateError('CONFLICT', app.status);
      const row = get('SELECT * FROM answers WHERE application_id = ? AND position = ?', appId, position);
      if (!row) throw new StateError('NOT_FOUND', 'pregunta');
      if (row.answered_at) throw new StateError('ALREADY');
      run('UPDATE answers SET answer = ?, answered_at = ? WHERE application_id = ? AND position = ?',
        answer, now(), appId, position);
      if (row.key === 'minecraft' && answer) run('UPDATE applications SET mc_username = ? WHERE id = ?', answer, appId);
      if (row.key === 'discord' && answer) run('UPDATE applications SET discord_username = ? WHERE id = ?', answer, appId);
      return getAnswers(appId);
    });
  }

  function resetAnswers(appId) {
    tx(() => {
      const app = getApplication(appId);
      if (!app || app.status !== 'preparacion') throw new StateError('CONFLICT', app?.status);
      run('UPDATE answers SET answer = NULL, answered_at = NULL WHERE application_id = ?', appId);
      run('UPDATE applications SET mc_username = NULL WHERE id = ?', appId);
    });
  }

  // ───────────── Observaciones e historial ─────────────
  function addNote(appId, authorId, text) {
    run('INSERT INTO notes (application_id, author_id, text, created_at) VALUES (?,?,?,?)', appId, authorId, text, now());
  }
  const listNotes = (appId) => all('SELECT * FROM notes WHERE application_id = ? ORDER BY id ASC', appId);
  const listHistory = (appId) => all('SELECT * FROM history WHERE application_id = ? ORDER BY id ASC', appId);

  // ───────────── Listados ─────────────
  function listApplications(guildId, statuses, limit, offset) {
    return all(
      `SELECT * FROM applications WHERE guild_id = ? AND status IN (${placeholders(statuses)})
       ORDER BY COALESCE(submitted_at, created_at) ASC, id ASC LIMIT ? OFFSET ?`,
      guildId, ...statuses, limit, offset,
    );
  }
  function countApplications(guildId, statuses) {
    return get(
      `SELECT COUNT(*) AS c FROM applications WHERE guild_id = ? AND status IN (${placeholders(statuses)})`,
      guildId, ...statuses,
    ).c;
  }

  // ───────────── Mantenimiento ─────────────
  const listDueDeletions = (t) =>
    all('SELECT * FROM applications WHERE delete_at IS NOT NULL AND delete_at <= ? AND channel_id IS NOT NULL', t);
  const listAbandoned = (cutoff) =>
    all("SELECT * FROM applications WHERE status = 'preparacion' AND created_at <= ?", cutoff);
  const listActiveWithChannel = () =>
    all(`SELECT * FROM applications WHERE channel_id IS NOT NULL AND status IN (${placeholders(ACTIVE_STATUSES)})`, ...ACTIVE_STATUSES);

  // ───────────── Estadísticas (solo datos reales) ─────────────
  function stats(guildId) {
    const byStatus = {};
    for (const r of all('SELECT status, COUNT(*) AS c FROM applications WHERE guild_id = ? GROUP BY status', guildId)) {
      byStatus[r.status] = r.c;
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const avg = get(
      `SELECT AVG(resolved_at - submitted_at) AS a, COUNT(*) AS c FROM applications
       WHERE guild_id = ? AND resolved_at IS NOT NULL AND submitted_at IS NOT NULL`,
      guildId,
    );
    const t = now();
    const since = (ms) => get('SELECT COUNT(*) AS c FROM applications WHERE guild_id = ? AND created_at >= ?', guildId, t - ms).c;
    const reviewers = all(
      `SELECT h.actor_id AS actor_id, COUNT(*) AS actions,
              SUM(CASE WHEN h.to_status IN ('aceptada','rechazada') THEN 1 ELSE 0 END) AS decisions
       FROM history h JOIN applications a ON a.id = h.application_id
       WHERE a.guild_id = ? AND h.actor_id != a.user_id
         AND h.to_status IN ('revision','info_solicitada','aceptada','rechazada','cerrada')
       GROUP BY h.actor_id ORDER BY actions DESC LIMIT 5`,
      guildId,
    );
    return {
      total,
      byStatus,
      avgResolutionMs: avg.c > 0 && avg.a != null ? Number(avg.a) : null,
      resolvedCount: avg.c,
      last24h: since(24 * 3600 * 1000),
      last7d: since(7 * 24 * 3600 * 1000),
      last30d: since(30 * 24 * 3600 * 1000),
      reviewers,
    };
  }

  function getFull(appId) {
    const app = getApplication(appId);
    if (!app) return null;
    return { app, answers: getAnswers(appId), notes: listNotes(appId), history: listHistory(appId) };
  }

  return {
    db, tx, getConfig, ensureGuild, updateConfig,
    listQuestions, addQuestion, updateQuestion, deleteQuestion, moveQuestion, resetQuestions,
    listRequirements, addRequirement, updateRequirement, deleteRequirement,
    getApplication, getByNumber, getByChannel, getActiveByUser, createApplication, deleteApplication,
    setChannel, clearChannel, setDossier, setDeleteAt, transition,
    getAnswers, saveAnswer, resetAnswers,
    addNote, listNotes, listHistory,
    listApplications, countApplications,
    listDueDeletions, listAbandoned, listActiveWithChannel,
    stats, getFull,
  };
}

module.exports = { createRepo, StateError };
