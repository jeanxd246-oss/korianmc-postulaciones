'use strict';

const { PermissionFlagsBits: P, MessageFlags, AttachmentBuilder } = require('discord.js');
const db = require('../../database');
const { STATUS, PENDING_STATUSES, COLORS, STATUS_META } = require('../../config/constants');
const {
  dossierEmbed, answersEmbeds, groupEmbeds, warnEmbed, successEmbed, errorEmbed, statsEmbed, helpEmbed, infoEmbed,
} = require('../../utils/embeds');
const { confirmRow } = require('../../utils/components');
const { fmtId, ts } = require('../../utils/format');
const { getAccess } = require('../../utils/permissions');
const { say, sayError, finish, sendGroups } = require('../../utils/respond');
const reviewService = require('../../services/reviewService');
const { buildQueue } = require('../../services/queueService');
const { logApp } = require('../../services/logService');
const { fetchChannel } = require('../../services/discordUtil');
const { resolveApp } = require('./helpers');

async function queue(i) {
  return say(i, buildQueue(i.guildId, i.options.getString('estado') || 'pendientes', Math.max((i.options.getInteger('pagina') || 1) - 1, 0)));
}

async function view(i) {
  const app = await resolveApp(i, { allowChannel: true });
  if (!app) return null;
  const repo = db.repo;
  await say(i, {
    embeds: [dossierEmbed(app, { requirements: repo.listRequirements(i.guildId), notes: repo.listNotes(app.id), history: repo.listHistory(app.id), includePrivate: true })],
  });
  return sendGroups(i, groupEmbeds(answersEmbeds(repo.getAnswers(app.id), 'Respuestas del postulante')));
}

async function confirmDecision(i, kind) {
  const app = await resolveApp(i);
  if (!app) return null;
  if (app.user_id === i.user.id) return sayError(i, 'Acción no permitida', 'No puedes resolver tu propia postulación.');
  if (!PENDING_STATUSES.includes(app.status)) return sayError(i, 'Acción no disponible', `El expediente ${fmtId(app)} está «${STATUS_META[app.status].label}».`);
  return say(i, {
    embeds: [warnEmbed(`¿Confirmas que quieres ${kind === 'a' ? 'aceptar' : 'rechazar'} la postulación ${fmtId(app)}?`, `Postulante: <@${app.user_id}>`)],
    components: confirmRow(kind, app.id),
  });
}

async function state(i) {
  const app = await resolveApp(i);
  if (!app) return null;
  const next = i.options.getString('nuevo');
  if (!next) {
    const history = db.repo.listHistory(app.id).slice(-10)
      .map((h) => `${STATUS_META[h.to_status].emoji} ${STATUS_META[h.to_status].label} — <@${h.actor_id}> ${ts(h.created_at, 'R')}${h.reason ? ` (${h.reason.slice(0, 80)})` : ''}`).join('\n');
    return say(i, { embeds: [infoEmbed(`Estado de ${fmtId(app)}: ${STATUS_META[app.status].label}`, history || '—')] });
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await reviewService.setPendingState(i.client, i.guild, app.id, i.user.id, next);
    return finish(i, { embeds: [successEmbed('Estado actualizado', `${fmtId(app)} → ${STATUS_META[next].label}.`)] });
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return finish(i, { embeds: [errorEmbed('No se pudo cambiar el estado', msg)] });
    throw err;
  }
}

async function closeCmd(i) {
  const app = await resolveApp(i);
  if (!app) return null;
  if (app.status === STATUS.CERRADA) return sayError(i, 'Acción no disponible', 'El expediente ya está cerrado.');
  return say(i, { embeds: [warnEmbed(`¿Cerrar el ticket de ${fmtId(app)}?`, 'El postulante dejará de poder escribir.')], components: confirmRow('c', app.id) });
}

async function reopenCmd(i) {
  const app = await resolveApp(i, { allowChannel: true });
  if (!app) return null;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await reviewService.reopen(i.client, i.guild, app.id, i.user.id);
    return finish(i, { embeds: [successEmbed('Expediente reabierto', `${fmtId(app)} vuelve a revisión.`)] });
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return finish(i, { embeds: [errorEmbed('No se pudo reabrir', msg)] });
    throw err;
  }
}

async function ticketAccess(i, add) {
  const app = await resolveApp(i);
  if (!app) return null;
  const member = i.options.getUser('miembro', true);
  if (member.bot) return sayError(i, 'Usuario no válido', 'No se puede usar un bot.');
  if (!app.channel_id) return sayError(i, 'Sin ticket', 'Este expediente ya no tiene canal.');
  if (app.status === STATUS.CERRADA) return sayError(i, 'Expediente cerrado', 'Reábrelo primero.');
  if (!add && (member.id === app.user_id || member.id === i.client.user.id)) return sayError(i, 'Acción no permitida', 'No puedes retirar al postulante ni al bot.');
  const channel = await fetchChannel(i.guild, app.channel_id);
  if (!channel) return sayError(i, 'Canal no encontrado', 'El canal del ticket ya no existe.');
  if (add) {
    await channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, EmbedLinks: true, AttachFiles: true });
  } else {
    await channel.permissionOverwrites.delete(member.id);
  }
  await logApp(i.client, i.guildId, app, { title: add ? 'Acceso añadido al ticket' : 'Acceso retirado del ticket', actorId: i.user.id, extra: [{ name: 'Miembro', value: `<@${member.id}>`, inline: true }] });
  return say(i, { embeds: [successEmbed(add ? 'Acceso concedido' : 'Acceso retirado', `<@${member.id}> ${add ? 'ahora puede ver' : 'ya no puede ver'} ${fmtId(app)}.`)] });
}

async function stats(i) {
  return say(i, { embeds: [statsEmbed(db.repo.stats(i.guildId), i.guild.name)] });
}

async function exportCmd(i) {
  const app = await resolveApp(i, { allowChannel: true });
  if (!app) return null;
  const full = db.repo.getFull(app.id);
  const d = (ms) => (ms ? new Date(ms).toISOString() : '—');
  const lines = [
    `KorianMC Postulaciones — Expediente ${fmtId(app)}`,
    `Exportado: ${new Date().toISOString()} por ${i.user.id}`,
    '='.repeat(60),
    `Postulante: ${app.user_id}`, `Minecraft: ${app.mc_username || '—'}`, `Discord: ${app.discord_username || '—'}`,
    `Estado: ${STATUS_META[app.status].label}`, `Creada: ${d(app.created_at)}`, `Enviada: ${d(app.submitted_at)}`,
    `Resuelta: ${d(app.resolved_at)} por ${app.resolved_by || '—'}`, `Motivo: ${app.resolution_reason || '—'}`,
    '', '── RESPUESTAS ──',
    ...full.answers.map((a) => `\n[${a.position}] ${a.label}\n${a.question_text}\n→ ${a.answered_at ? (a.answer || '(omitida)') : '(sin responder)'}`),
    '', '── OBSERVACIONES INTERNAS ──',
    ...(full.notes.length ? full.notes.map((n) => `${d(n.created_at)} ${n.author_id}: ${n.text}`) : ['(ninguna)']),
    '', '── HISTORIAL ──',
    ...full.history.map((h) => `${d(h.created_at)} ${h.from_status || '∅'} → ${h.to_status} por ${h.actor_id}${h.reason ? ` (${h.reason})` : ''}`),
  ];
  const file = new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `postulacion-${String(app.number).padStart(4, '0')}.txt` });
  await logApp(i.client, i.guildId, app, { title: 'Expediente exportado', color: COLORS.warning, actorId: i.user.id });
  return i.reply({ files: [file], flags: MessageFlags.Ephemeral });
}

async function help(i, ctx) {
  return say(i, { embeds: [helpEmbed(ctx.access.reviewer, ctx.access.admin)] });
}

module.exports = { queue, view, confirmDecision, state, closeCmd, reopenCmd, ticketAccess, stats, exportCmd, help };
