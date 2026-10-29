'use strict';

// Prueba de flujo completo con objetos de Discord simulados (no usa la red).
let discordAvailable = true;
try { require('discord.js'); } catch { discordAvailable = false; }

const test = require('node:test');
const assert = require('node:assert/strict');

function makeWorld() {
  const sent = [];
  const channels = new Map();
  let n = 100;
  const mkChannel = (name) => {
    const ch = {
      id: String(++n), name, type: 0, sent: [], overwrites: [],
      isTextBased: () => true, isThread: () => false,
      send: async (p) => { ch.sent.push(p); return { id: `m${ch.sent.length}`, edit: async () => {} }; },
      messages: { fetch: async () => ({ edit: async () => {} }), delete: async () => {} },
      permissionOverwrites: { edit: async (id, p) => { ch.overwrites.push([id, p]); }, delete: async () => {} },
      delete: async () => { channels.delete(ch.id); },
    };
    channels.set(ch.id, ch);
    return ch;
  };
  const guild = {
    id: 'G1', ownerId: 'owner',
    roles: { everyone: { id: 'G1' }, cache: new Map([['R1', {}]]) },
    channels: {
      create: async (o) => { const c = mkChannel(o.name); c.options = o; return c; },
      fetch: async (id) => { if (!channels.has(id)) throw new Error('Unknown Channel'); return channels.get(id); },
    },
  };
  const dms = [];
  const client = {
    user: { id: 'BOT' },
    users: { fetch: async (id) => ({ id, send: async (p) => { dms.push([id, p]); } }) },
    channels: { fetch: async (id) => channels.get(id) ?? null },
  };
  return { guild, client, channels, dms, mkChannel };
}

test('flujo: iniciar → responder → enviar → aceptar → cerrar → reabrir', { skip: !discordAvailable }, async () => {
  const database = require('../src/database');
  database.close();
  const repo = database.init(':memory:');
  const applicationService = require('../src/services/applicationService');
  const reviewService = require('../src/services/reviewService');
  const apply = require('../src/interactions/apply');

  const w = makeWorld();
  const review = w.mkChannel('revision-staff');
  repo.ensureGuild('G1');
  repo.updateConfig('G1', { review_channel_id: review.id, reviewer_roles: ['R1'], close_delete_seconds: 0 });

  const user = { id: 'U1', username: 'Ñandú Test' };
  const edits = [];
  const startInteraction = { guild: w.guild, user, client: w.client, editReply: async (p) => { edits.push(p); } };
  await applicationService.startApplication(startInteraction);
  const app = repo.getActiveByUser('G1', 'U1');
  assert.ok(app && app.channel_id, 'se creó el expediente y el canal');
  const ticket = w.channels.get(app.channel_id);
  assert.equal(ticket.options.name, 'postulacion-nandu-test');
  assert.ok(ticket.options.permissionOverwrites.some((o) => o.id === 'G1' && o.deny.length), '@everyone sin acceso');
  assert.ok(ticket.options.permissionOverwrites.some((o) => o.id === 'R1'), 'rol revisor con acceso');

  // segundo intento: bloqueado
  await applicationService.startApplication(startInteraction);
  assert.equal(repo.listApplications('G1', ['preparacion'], 10, 0).length, 1);
  assert.match(JSON.stringify(edits.at(-1)), /Ya tienes una postulación activa/);

  // responder todas las preguntas con el manejador real del modal
  const answersByKey = { minecraft: 'Steve_99', edad: '21' };
  for (;;) {
    const row = repo.getAnswers(app.id).find((a) => !a.answered_at);
    if (!row) break;
    const value = answersByKey[row.key] ?? `Respuesta ${row.position}`;
    let updated = false;
    const modal = {
      guildId: 'G1', channelId: ticket.id, channel: ticket, user, client: w.client,
      fields: { getTextInputValue: () => value }, isFromMessage: () => true,
      update: async () => { updated = true; },
      reply: async () => { throw new Error('no debería responder error'); },
    };
    await apply.handle(modal, ['ap', 'mda', String(app.id), String(row.position)]);
    assert.ok(updated);
  }
  assert.equal(repo.getApplication(app.id).mc_username, 'Steve_99');

  // un usuario ajeno no puede enviar la postulación
  let denied = '';
  await apply.handle({ guildId: 'G1', channelId: ticket.id, user: { id: 'X' }, deferred: false, replied: false, reply: async (p) => { denied = JSON.stringify(p); } }, ['ap', 'submit', String(app.id)]);
  assert.match(denied, /Solo el postulante/);

  // enviar
  let submitted = false;
  await apply.handle({ guildId: 'G1', channelId: ticket.id, guild: w.guild, client: w.client, user, update: async () => { submitted = true; } }, ['ap', 'submit', String(app.id)]);
  assert.ok(submitted);
  assert.equal(repo.getApplication(app.id).status, 'enviada');
  assert.ok(review.sent.length >= 2, 'expediente y respuestas publicados en el canal de revisión');
  assert.ok(repo.getApplication(app.id).dossier_message_id);

  // el postulante no puede aceptar su propia postulación
  await assert.rejects(() => reviewService.accept(w.client, w.guild, app.id, 'U1', null), (e) => e.code === 'SELF');

  // revisor acepta; botón antiguo de rechazo falla
  const res = await reviewService.accept(w.client, w.guild, app.id, 'REV1', 'Buen perfil');
  assert.equal(res.app.status, 'aceptada');
  assert.equal(w.dms.length, 1, 'MD enviado');
  await assert.rejects(() => reviewService.reject(w.client, w.guild, app.id, 'REV2', null), (e) => e.code === 'CONFLICT');

  // cierre y reapertura
  const closed = await reviewService.close(w.client, w.guild, app.id, 'REV1', 'fin');
  assert.equal(closed.status, 'cerrada');
  assert.ok(ticket.overwrites.some(([id, p]) => id === 'U1' && p.SendMessages === false), 'postulante bloqueado');
  const reopened = await reviewService.reopen(w.client, w.guild, app.id, 'REV1');
  assert.equal(reopened.status, 'revision');

  // tras cerrar puede volver a postular
  await reviewService.close(w.client, w.guild, app.id, 'REV1', null);
  await applicationService.startApplication(startInteraction);
  assert.equal(repo.getActiveByUser('G1', 'U1').number, 2);
  assert.equal(repo.stats('G1').total, 2);
});

test('DM bloqueado no rompe la decisión', { skip: !discordAvailable }, async () => {
  const database = require('../src/database');
  database.close();
  const repo = database.init(':memory:');
  const reviewService = require('../src/services/reviewService');
  const w = makeWorld();
  repo.ensureGuild('G1');
  const a = repo.createApplication('G1', 'U9', 'x');
  repo.transition(a.id, 'preparacion', 'enviada', 'U9');
  w.client.users.fetch = async () => ({ send: async () => { throw new Error('Cannot send messages to this user'); } });
  const res = await reviewService.reject(w.client, w.guild, a.id, 'REV', 'No cumple');
  assert.equal(res.app.status, 'rechazada');
  assert.equal(res.dm, false);
});
