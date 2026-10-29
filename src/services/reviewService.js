'use strict';

const db = require('../database');
const { StateError } = require('../database');
const { withLock } = require('../utils/lock');
const { PENDING_STATUSES, STATUS, COLORS } = require('../config/constants');
const {
  acceptEmbed, rejectEmbed, infoRequestEmbed, closeEmbed, reopenEmbed,
} = require('../utils/embeds');
const { infoReplyRow } = require('../utils/components');
const { fmtId } = require('../utils/format');
const { logApp } = require('./logService');
const { postDossier, refreshDossier } = require('./dossierService');
const { lockApplicant, unlockApplicant, createTicketChannel } = require('./ticketService');
const { fetchChannel, safe } = require('./discordUtil');
const logger = require('../utils/logger');

const CLOSABLE = ['preparacion', 'enviada', 'revision', 'info_solicitada', 'aceptada', 'rechazada'];

async function sendToTicket(guild, app, payload) {
  const channel = app.channel_id ? await fetchChannel(guild, app.channel_id) : null;
  if (!channel) return null;
  return safe('Mensaje en el ticket', () => channel.send({ allowedMentions: { users: [app.user_id] }, ...payload }));
}

// MD al postulante. Si falla, se registra y el proceso continúa.
async function notifyUser(client, guild, config, app, embed) {
  if (!config.dm_notifications) return false;
  try {
    const user = await client.users.fetch(app.user_id);
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    logger.warn(`MD no entregado al usuario ${app.user_id} (expediente ${app.id}): ${err.message}`);
    await logApp(client, guild.id, app, {
      title: 'No se pudo enviar el mensaje directo',
      color: COLORS.warning,
      reason: 'El usuario tiene los mensajes directos desactivados o bloqueó al bot. Se le avisó en su ticket.',
    });
    return false;
  }
}

function assertNotSelf(app, actorId) {
  if (app.user_id === actorId) throw new StateError('SELF');
}

async function decide(client, guild, appId, to, actorId, reason) {
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    const existing = repo.getApplication(appId);
    if (!existing) throw new StateError('NOT_FOUND');
    assertNotSelf(existing, actorId);
    const config = repo.getConfig(guild.id);
    const app = repo.transition(appId, PENDING_STATUSES, to, actorId, reason || null);
    const accepted = to === STATUS.ACEPTADA;
    const embed = accepted ? acceptEmbed(config, app, reason) : rejectEmbed(config, app, reason);
    await sendToTicket(guild, app, { content: `<@${app.user_id}>`, embeds: [embed] });
    const dm = await notifyUser(client, guild, config, app, embed);
    await refreshDossier(client, guild, appId);
    await logApp(client, guild.id, app, {
      title: accepted ? 'Postulación aceptada' : 'Postulación rechazada',
      color: accepted ? COLORS.success : COLORS.danger,
      actorId,
      reason: reason || 'No indicado',
      extra: [{ name: 'MD al postulante', value: dm ? 'Entregado' : config.dm_notifications ? 'No entregado' : 'Desactivado', inline: true }],
    });
    return { app, dm };
  });
}

const accept = (client, guild, appId, actorId, reason) => decide(client, guild, appId, STATUS.ACEPTADA, actorId, reason);
const reject = (client, guild, appId, actorId, reason) => decide(client, guild, appId, STATUS.RECHAZADA, actorId, reason);

async function requestInfo(client, guild, appId, actorId, message) {
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    const config = repo.getConfig(guild.id);
    const app = repo.transition(appId, [STATUS.ENVIADA, STATUS.REVISION], STATUS.INFO, actorId, message);
    const embed = infoRequestEmbed(app, message);
    await sendToTicket(guild, app, { content: `<@${app.user_id}>`, embeds: [embed], components: infoReplyRow(app.id) });
    await notifyUser(client, guild, config, app, embed);
    await refreshDossier(client, guild, appId);
    await logApp(client, guild.id, app, { title: 'Información solicitada', color: COLORS.warning, actorId, reason: message });
    return app;
  });
}

async function markReview(client, guild, appId, actorId) {
  return withLock(`app:${appId}`, async () => {
    const app = db.repo.transition(appId, [STATUS.ENVIADA, STATUS.INFO], STATUS.REVISION, actorId, 'Marcada para revisión');
    await refreshDossier(client, guild, appId);
    await logApp(client, guild.id, app, { title: 'Postulación en revisión', actorId });
    return app;
  });
}

// Cambio manual entre estados pendientes (comando /estado).
async function setPendingState(client, guild, appId, actorId, to) {
  return withLock(`app:${appId}`, async () => {
    const app = db.repo.transition(appId, PENDING_STATUSES, to, actorId, 'Cambio manual de estado');
    await refreshDossier(client, guild, appId);
    await logApp(client, guild.id, app, { title: 'Cambio de estado', actorId, extra: [{ name: 'Nuevo estado', value: to, inline: true }] });
    return app;
  });
}

// El postulante indica que ya respondió a la solicitud de información.
async function applicantReplied(client, guild, appId, userId) {
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    const config = repo.getConfig(guild.id);
    const app = repo.transition(appId, [STATUS.INFO], STATUS.ENVIADA, userId, 'El postulante respondió a la solicitud de información');
    await refreshDossier(client, guild, appId);
    const target = app.dossier_channel_id ? await fetchChannel(guild, app.dossier_channel_id) : null;
    const roles = config.ping_reviewers ? (config.reviewer_roles || []) : [];
    if (target) {
      await safe('Aviso de respuesta', () => target.send({
        content: `${roles.map((r) => `<@&${r}>`).join(' ')} ${fmtId(app)}: el postulante ha respondido a la solicitud de información.`.trim(),
        allowedMentions: { roles },
      }));
    }
    await logApp(client, guild.id, app, { title: 'El postulante respondió a la información solicitada', actorId: userId });
    return app;
  });
}

async function addNote(client, guild, appId, actorId, text) {
  const repo = db.repo;
  const app = repo.getApplication(appId);
  if (!app) throw new StateError('NOT_FOUND');
  if (app.status === STATUS.CERRADA) throw new StateError('CONFLICT', app.status);
  repo.addNote(appId, actorId, text);
  await refreshDossier(client, guild, appId);
  await logApp(client, guild.id, app, { title: 'Observación interna añadida', actorId });
  return app;
}

async function close(client, guild, appId, actorId, reason) {
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    const config = repo.getConfig(guild.id);
    const app = repo.transition(appId, CLOSABLE, STATUS.CERRADA, actorId, reason || null);
    const deleteAt = config.close_delete_seconds > 0 ? Date.now() + config.close_delete_seconds * 1000 : null;
    if (deleteAt) repo.setDeleteAt(appId, deleteAt);
    const channel = app.channel_id ? await fetchChannel(guild, app.channel_id) : null;
    if (channel) {
      await safe('Bloquear ticket', () => lockApplicant(channel, app.user_id));
      await safe('Mensaje de cierre', () => channel.send({ embeds: [closeEmbed(app, reason, deleteAt)] }));
    }
    await refreshDossier(client, guild, appId);
    await logApp(client, guild.id, app, { title: 'Ticket cerrado', actorId, reason: reason || undefined });
    return db.repo.getApplication(appId);
  });
}

async function reopen(client, guild, appId, actorId) {
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    const before = repo.getApplication(appId);
    if (!before) throw new StateError('NOT_FOUND');
    if (!before.submitted_at) throw new StateError('INVALID', 'La postulación nunca fue enviada.');
    const config = repo.getConfig(guild.id);
    const app = repo.transition(appId, [STATUS.CERRADA, STATUS.ACEPTADA, STATUS.RECHAZADA], STATUS.REVISION, actorId, 'Reapertura autorizada');
    let channel = app.channel_id ? await fetchChannel(guild, app.channel_id) : null;
    if (channel) {
      await safe('Desbloquear ticket', () => unlockApplicant(channel, app.user_id));
    } else {
      const user = await client.users.fetch(app.user_id).catch(() => null);
      if (user) {
        channel = await safe('Recrear ticket', () => createTicketChannel(client, guild, config, app, user));
        if (channel) repo.setChannel(appId, channel.id);
      }
    }
    const fresh = repo.getApplication(appId);
    if (channel) {
      await safe('Aviso de reapertura', () => channel.send({ content: `<@${fresh.user_id}>`, embeds: [reopenEmbed(fresh, actorId)], allowedMentions: { users: [fresh.user_id] } }));
    }
    const dossierChannel = fresh.dossier_channel_id ? await fetchChannel(guild, fresh.dossier_channel_id) : null;
    if (!dossierChannel || !fresh.dossier_message_id) await safe('Republicar expediente', () => postDossier(client, guild, appId));
    else await refreshDossier(client, guild, appId);
    await logApp(client, guild.id, fresh, { title: 'Postulación reabierta', color: COLORS.primary, actorId });
    return fresh;
  });
}

function stateErrorMessage(err) {
  if (!(err instanceof StateError)) return null;
  switch (err.code) {
    case 'NOT_FOUND': return 'No se encontró la postulación.';
    case 'CONFLICT': return 'El estado de la postulación ha cambiado y esta acción ya no es válida. Actualiza el expediente.';
    case 'INVALID': return err.detail && !err.detail.includes('->') ? err.detail : 'Esa transición de estado no está permitida.';
    case 'SELF': return 'No puedes resolver tu propia postulación.';
    case 'DUPLICATE': return 'El usuario ya tiene otra postulación activa, por lo que no se puede reabrir esta.';
    case 'ALREADY': return 'Esa pregunta ya fue respondida.';
    case 'NO_QUESTIONS': return 'No hay preguntas configuradas. Avisa a un administrador.';
    default: return 'No se pudo completar la acción.';
  }
}

module.exports = {
  accept, reject, requestInfo, markReview, setPendingState, applicantReplied, addNote, close, reopen,
  stateErrorMessage, notifyUser, sendToTicket,
};
