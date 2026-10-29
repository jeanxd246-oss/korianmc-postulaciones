'use strict';

const { TextInputStyle } = require('discord.js');
const db = require('../database');
const { PENDING_STATUSES, STATUS, LIMITS } = require('../config/constants');
const { infoEmbed, warnEmbed, successEmbed } = require('../utils/embeds');
const { confirmRow, textModal } = require('../utils/components');
const { getAccess } = require('../utils/permissions');
const { cleanText } = require('../utils/validate');
const { fmtId } = require('../utils/format');
const { say, sayError, deny, finish } = require('../utils/respond');
const reviewService = require('../services/reviewService');
const { MessageFlags } = require('discord.js');

// Carga y valida: servidor correcto, permisos de revisor y expediente existente.
async function context(interaction, idStr) {
  const app = db.repo.getApplication(Number(idStr));
  if (!app || app.guild_id !== interaction.guildId) {
    await sayError(interaction, 'Postulación no encontrada', 'Este expediente ya no existe.');
    return null;
  }
  const config = db.repo.ensureGuild(interaction.guildId);
  if (!getAccess(interaction, config).reviewer) {
    await deny(interaction);
    return null;
  }
  return app;
}

const isPending = (app) => PENDING_STATUSES.includes(app.status);

async function askConfirm(interaction, app, kind) {
  if (app.user_id === interaction.user.id) {
    return sayError(interaction, 'Acción no permitida', 'No puedes resolver tu propia postulación.');
  }
  if (!isPending(app)) {
    return sayError(interaction, 'Acción no disponible', `El expediente ${fmtId(app)} está en estado «${app.status}» y ya no admite esta acción.`);
  }
  const verb = kind === 'a' ? 'aceptar' : 'rechazar';
  return say(interaction, {
    embeds: [warnEmbed(`¿Confirmas que quieres ${verb} la postulación ${fmtId(app)}?`, `Postulante: <@${app.user_id}>\nSe notificará al postulante y quedará registrado en el historial.`)],
    components: confirmRow(kind, app.id),
  });
}

async function openReasonModal(interaction, app, kind) {
  if (!isPending(app) || app.user_id === interaction.user.id) {
    return sayError(interaction, 'Acción no disponible', 'El expediente cambió de estado o no puedes resolverlo.');
  }
  const accept = kind === 'a';
  return interaction.showModal(textModal({
    customId: `rv:md${kind}:${app.id}`,
    title: accept ? 'Aceptar postulación' : 'Rechazar postulación',
    label: accept ? 'Mensaje para el postulante' : 'Motivo del rechazo',
    required: false,
    max: LIMITS.reasonMax,
    placeholder: 'Opcional. Se enviará al postulante y quedará en el historial.',
  }));
}

async function runDecision(interaction, app, kind) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reason = cleanText(interaction.fields.getTextInputValue('value'), LIMITS.reasonMax) || null;
  try {
    const fn = kind === 'a' ? reviewService.accept : reviewService.reject;
    const { dm } = await fn(interaction.client, interaction.guild, app.id, interaction.user.id, reason);
    const extra = dm ? '' : '\nNo se pudo entregar el mensaje directo; el postulante fue avisado en su ticket.';
    return finish(interaction, { embeds: [successEmbed(kind === 'a' ? 'Postulación aceptada' : 'Postulación rechazada', `Expediente ${fmtId(app)} actualizado.${extra}`)] });
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return finish(interaction, { embeds: [warnEmbed('No se pudo completar', msg)] });
    throw err;
  }
}

async function handle(interaction, parts) {
  const [, action, idStr] = parts;
  const app = await context(interaction, idStr);
  if (!app) return null;
  const actor = interaction.user.id;

  try {
    switch (action) {
      case 'accept': return await askConfirm(interaction, app, 'a');
      case 'reject': return await askConfirm(interaction, app, 'r');
      case 'cfa': return await openReasonModal(interaction, app, 'a');
      case 'cfr': return await openReasonModal(interaction, app, 'r');
      case 'mda': return await runDecision(interaction, app, 'a');
      case 'mdr': return await runDecision(interaction, app, 'r');
      case 'no':
        return await interaction.update({ embeds: [infoEmbed('Acción cancelada', 'No se realizó ningún cambio.')], components: [] });
      case 'info':
        if (!isPending(app)) return await sayError(interaction, 'Acción no disponible', 'El expediente ya no admite solicitudes de información.');
        return await interaction.showModal(textModal({
          customId: `rv:mdi:${app.id}`, title: 'Solicitar información', label: 'Qué necesitas saber', max: 1000,
          placeholder: 'Se enviará al postulante en su ticket.',
        }));
      case 'mdi': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const message = cleanText(interaction.fields.getTextInputValue('value'), 1000);
        await reviewService.requestInfo(interaction.client, interaction.guild, app.id, actor, message);
        return await finish(interaction, { embeds: [successEmbed('Información solicitada', `Se avisó al postulante en su ticket (${fmtId(app)}).`)] });
      }
      case 'review': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await reviewService.markReview(interaction.client, interaction.guild, app.id, actor);
        return await finish(interaction, { embeds: [successEmbed('Marcada para revisión', `El expediente ${fmtId(app)} está en revisión.`)] });
      }
      case 'note':
        if (app.status === STATUS.CERRADA) return await sayError(interaction, 'Acción no disponible', 'El expediente está cerrado.');
        return await interaction.showModal(textModal({
          customId: `rv:mdn:${app.id}`, title: 'Observación interna', label: 'Observación', max: LIMITS.noteMax,
          placeholder: 'Solo la verá el equipo autorizado.',
        }));
      case 'mdn': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const text = cleanText(interaction.fields.getTextInputValue('value'), LIMITS.noteMax);
        if (!text) return await finish(interaction, { embeds: [warnEmbed('Observación vacía', 'Escribe algo para guardarla.')] });
        await reviewService.addNote(interaction.client, interaction.guild, app.id, actor, text);
        return await finish(interaction, { embeds: [successEmbed('Observación guardada', `Añadida al expediente ${fmtId(app)}.`)] });
      }
      case 'close':
        if (app.status === STATUS.CERRADA) return await sayError(interaction, 'Acción no disponible', 'El expediente ya está cerrado.');
        return await say(interaction, {
          embeds: [warnEmbed(`¿Cerrar el ticket de ${fmtId(app)}?`, 'El postulante dejará de poder escribir en el canal. Se podrá reabrir con una acción autorizada.')],
          components: confirmRow('c', app.id),
        });
      case 'cfc': {
        await interaction.deferUpdate();
        await reviewService.close(interaction.client, interaction.guild, app.id, actor, `Cerrado por <@${actor}>`);
        return await interaction.editReply({ embeds: [successEmbed('Ticket cerrado', `El expediente ${fmtId(app)} se cerró correctamente.`)], components: [] });
      }
      default:
        return await sayError(interaction, 'Botón no reconocido', 'Esta acción ya no está disponible.');
    }
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (!msg) throw err;
    if (interaction.deferred) return finish(interaction, { embeds: [warnEmbed('No se pudo completar', msg)], components: [] });
    return sayError(interaction, 'No se pudo completar', msg);
  }
}

module.exports = { prefix: 'rv', handle };
