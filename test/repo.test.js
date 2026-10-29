'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../src/database');
const { StateError } = require('../src/database');
const { DEFAULT_QUESTIONS } = require('../src/config/constants');

function fresh() {
  database.close();
  return database.init(':memory:');
}

test('ensureGuild siembra preguntas por defecto una sola vez y aísla servidores', () => {
  const repo = fresh();
  repo.ensureGuild('g1');
  repo.ensureGuild('g1');
  repo.ensureGuild('g2');
  assert.equal(repo.listQuestions('g1').length, DEFAULT_QUESTIONS.length);
  repo.deleteQuestion('g1', 1);
  assert.equal(repo.listQuestions('g1').length, DEFAULT_QUESTIONS.length - 1);
  assert.equal(repo.listQuestions('g2').length, DEFAULT_QUESTIONS.length);
  assert.equal(repo.listRequirements('g1').length, 0, 'sin requisitos por defecto');
});

test('configuración independiente por servidor', () => {
  const repo = fresh();
  repo.ensureGuild('a'); repo.ensureGuild('b');
  repo.updateConfig('a', { category_id: '111', reviewer_roles: ['r1', 'r2'], dm_notifications: false });
  assert.equal(repo.getConfig('a').category_id, '111');
  assert.deepEqual(repo.getConfig('a').reviewer_roles, ['r1', 'r2']);
  assert.equal(repo.getConfig('a').dm_notifications, false);
  assert.equal(repo.getConfig('b').category_id, null);
  assert.throws(() => repo.updateConfig('a', { evil: 1 }));
});

test('no permite dos postulaciones activas del mismo usuario', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  const a = repo.createApplication('g', 'u1', 'user1');
  assert.equal(a.number, 1);
  assert.throws(() => repo.createApplication('g', 'u1', 'user1'), (e) => e instanceof StateError && e.code === 'DUPLICATE');
  const b = repo.createApplication('g', 'u2', 'user2');
  assert.equal(b.number, 2);
  repo.transition(a.id, 'preparacion', 'cerrada', 'u1', 'cancelada');
  const c = repo.createApplication('g', 'u1', 'user1');
  assert.equal(c.number, 3);
});

test('flujo de respuestas, envío y decisión con historial', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  const app = repo.createApplication('g', 'u1', 'user1');
  let answers = repo.getAnswers(app.id);
  assert.equal(answers.length, DEFAULT_QUESTIONS.length);
  answers = repo.saveAnswer(app.id, 1, 'Steve_99');
  assert.equal(repo.getApplication(app.id).mc_username, 'Steve_99');
  assert.throws(() => repo.saveAnswer(app.id, 1, 'otra'), (e) => e.code === 'ALREADY');
  const sent = repo.transition(app.id, 'preparacion', 'enviada', 'u1');
  assert.ok(sent.submitted_at);
  assert.throws(() => repo.saveAnswer(app.id, 2, 'x'), (e) => e.code === 'CONFLICT');
  const acc = repo.transition(app.id, ['enviada', 'revision'], 'aceptada', 'rev1', 'Buen perfil');
  assert.equal(acc.resolved_by, 'rev1');
  assert.equal(acc.resolution_reason, 'Buen perfil');
  // botón antiguo: ya no se puede rechazar una aceptada
  assert.throws(() => repo.transition(app.id, ['enviada', 'revision'], 'rechazada', 'rev2'), (e) => e.code === 'CONFLICT');
  const closed = repo.transition(app.id, ['aceptada'], 'cerrada', 'rev1');
  assert.ok(closed.closed_at);
  const reopened = repo.transition(app.id, ['cerrada'], 'revision', 'rev1', 'Reapertura');
  assert.equal(reopened.resolved_at, null);
  assert.equal(reopened.closed_at, null);
  const hist = repo.listHistory(app.id).map((h) => h.to_status);
  assert.deepEqual(hist, ['preparacion', 'enviada', 'aceptada', 'cerrada', 'revision']);
});

test('reabrir falla si el usuario ya tiene otra postulación activa', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  const a = repo.createApplication('g', 'u1', 'x');
  repo.transition(a.id, 'preparacion', 'cerrada', 'u1');
  repo.createApplication('g', 'u1', 'x');
  assert.throws(() => repo.transition(a.id, 'cerrada', 'revision', 'adm'), (e) => e.code === 'DUPLICATE');
  assert.equal(repo.getApplication(a.id).status, 'cerrada', 'la transacción se revierte');
});

test('mover, editar y borrar preguntas mantiene posiciones contiguas; las postulaciones guardan copia', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  const app = repo.createApplication('g', 'u1', 'x');
  repo.moveQuestion('g', 1, 3);
  assert.equal(repo.listQuestions('g')[2].label, 'Usuario de Minecraft');
  repo.updateQuestion('g', 1, { label: 'Nuevo', required: false });
  const qs = repo.listQuestions('g');
  assert.deepEqual(qs.map((q) => q.position), qs.map((_, i) => i + 1));
  assert.equal(qs[0].required, 0);
  repo.deleteQuestion('g', 2);
  assert.deepEqual(repo.listQuestions('g').map((q) => q.position), repo.listQuestions('g').map((_, i) => i + 1));
  assert.equal(repo.getAnswers(app.id).length, DEFAULT_QUESTIONS.length, 'la copia de la postulación no cambia');
  repo.resetQuestions('g');
  assert.equal(repo.listQuestions('g').length, DEFAULT_QUESTIONS.length);
});

test('requisitos: alta, edición, borrado', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  repo.addRequirement('g', 'A'); repo.addRequirement('g', 'B'); repo.addRequirement('g', 'C');
  repo.updateRequirement('g', 2, 'B2');
  repo.deleteRequirement('g', 1);
  assert.deepEqual(repo.listRequirements('g').map((r) => [r.position, r.text]), [[1, 'B2'], [2, 'C']]);
  assert.throws(() => repo.deleteRequirement('g', 9), (e) => e.code === 'NOT_FOUND');
});

test('estadísticas con datos reales', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  assert.equal(repo.stats('g').total, 0);
  assert.equal(repo.stats('g').avgResolutionMs, null);
  const a = repo.createApplication('g', 'u1', 'x');
  const b = repo.createApplication('g', 'u2', 'x');
  repo.transition(a.id, 'preparacion', 'enviada', 'u1');
  repo.transition(a.id, 'enviada', 'aceptada', 'rev1');
  repo.transition(b.id, 'preparacion', 'enviada', 'u2');
  repo.transition(b.id, 'enviada', 'revision', 'rev2');
  const s = repo.stats('g');
  assert.equal(s.total, 2);
  assert.equal(s.byStatus.aceptada, 1);
  assert.equal(s.byStatus.revision, 1);
  assert.equal(s.last24h, 2);
  assert.ok(s.avgResolutionMs >= 0);
  assert.deepEqual(s.reviewers.map((r) => r.actor_id).sort(), ['rev1', 'rev2']);
  assert.equal(repo.countApplications('g', ['revision', 'enviada']), 1);
  assert.equal(repo.listApplications('g', ['revision'], 10, 0)[0].id, b.id);
});

test('notas y mantenimiento (borrados programados y abandonadas)', () => {
  const repo = fresh();
  repo.ensureGuild('g');
  const a = repo.createApplication('g', 'u1', 'x');
  repo.setChannel(a.id, 'c1');
  repo.addNote(a.id, 'rev', 'Nota interna');
  assert.equal(repo.listNotes(a.id)[0].text, 'Nota interna');
  assert.equal(repo.getByChannel('c1').id, a.id);
  assert.equal(repo.listAbandoned(Date.now() + 1000).length, 1);
  repo.setDeleteAt(a.id, Date.now() - 1);
  assert.equal(repo.listDueDeletions(Date.now()).length, 1);
  repo.clearChannel(a.id);
  assert.equal(repo.listDueDeletions(Date.now()).length, 0);
});

test('migraciones: user_version y reapertura idempotente', () => {
  database.close();
  database.init(':memory:');
  const v = database.db.prepare('PRAGMA user_version').get().user_version;
  assert.equal(Number(v), 1);
});
