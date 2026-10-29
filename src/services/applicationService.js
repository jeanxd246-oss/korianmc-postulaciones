'use strict';

const db = require('../database');
const { StateError } = require('../database');
const { withLock } = require('../utils/lock');
const { COLORS, ACTIVE_STATUSES, STATUS } = require('../config/constants');
const {
  welcomeEmbed, questionEmbed, answersEmbeds, groupEmbeds, summaryIntroEmbed, errorEmbed, successEmbed, infoEmbed,
} = require('../utils/embeds');
const { questionRow, submitRow } = require('../utils/components');
const { fmtId } = require('../utils/format');
const { createTicketChannel } = require('./ticketService');
const { postDossier } = require('./dossierService');
const { logApp } = require('./logService');
const { fetchChannel, fetchChannelById, safe } = require('./discordUtil');
const reviewService = require('./reviewService');
const logger = require('../utils/logger');

// Comprueba si el usuario ya tiene una postulación activa. Limpia expedientes huérfanos (canal borrado a mano).
async function findActive(client, guild, userId) {
  const repo = db.repo;
  const existing = repo.getActiveByUser(guild.id, userId);
  if (!existing) return { app: null, channel: null };
  const channel = existing.channel_id ? await fetchChannel(guild, existing.channel_id) : null;
  if (channel) return { app: existing, channel };
  try {
    repo.transition(existing.id, ACTIVE_STATUSES, STATUS.CERRADA, client.user.id, 'El canal del ticket ya no existe');
    await logApp(client, guild.id, existing, {
      title: 'Expediente cerrado automáticamente', color: COLORS.warning, reason: 'El canal del ticket fue eliminado manualmente.',
    });
  } catch (err) {
    logger.warn(`No se pudo cerrar el expediente huérfano ${existing.id}: ${err.message}`);
  }
  return { app: null, channel: null };
}

// Se llama tras pulsar "He leído los requisitos" (la interacción ya fue aplazada con deferUpdate).
async function startApplication(interaction) {
  const { guild, user, client } = interaction;
  const repo = db.repo;
  await withLock(`start:${guild.id}:${user.id}`, async () => {
    const config = repo.ensureGuild(guild.id);
    if (!repo.listQuestions(guild.id).length) {
      return interaction.editReply({ embeds: [errorEmbed('Sistema sin configurar', 'Aún no hay preguntas configuradas. Avisa a un administrador.')], components: [] });
    }
    const { app: active, channel: activeChannel } = await findActive(client, guild, user.id);
    if (active) {
      return interaction.editReply({
        embeds: [errorEmbed('Ya tienes una postulación activa', `Continúa tu proceso en ${activeChannel}. Solo se permite una postulación activa a la vez.`)],
        components: [],
      });
    }
    let app;
    try {
      app = repo.createApplication(guild.id, user.id, user.username);
    } catch (err) {
      if (err instanceof StateError && err.code === 'DUPLICATE') {
        return interaction.editReply({ embeds: [errorEmbed('Ya tienes una postulación activa', 'Solo se permite una postulación activa a la vez.')], components: [] });
      }
      throw err;
    }
    let channel;
    try {
      channel = await createTicketChannel(client, guild, config, app, user);
    } catch (err) {
      repo.deleteApplication(app.id);
      logger.error(`No se pudo crear el ticket en ${guild.id}: ${err.message}`);
      await logApp(client, guild.id, app, {
        title: 'Error al crear el ticket', color: COLORS.danger,
        reason: `Revisa los permisos del bot (Gestionar canales y roles) y la categoría configurada. Detalle: ${err.message}`.slice(0, 900),
      });
      return interaction.editReply({
        embeds: [errorEmbed('No se pudo crear tu ticket', 'Ocurrió un problema al crear el canal. Avisa a un administrador para que revise la configuración del bot.')],
        components: [],
      });
    }
    repo.setChannel(app.id, channel.id);
    app = repo.getApplication(app.id);
    await channel.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed(config, app)], allowedMentions: { users: [user.id] } });
    await sendNextQuestion(channel, app);
    await logApp(client, guild.id, app, { title: 'Postulación creada', color: COLORS.primary, actorId: user.id, extra: [{ name: 'Ticket', value: `<#${channel.id}>`, inline: true }] });
    return interaction.editReply({ embeds: [successEmbed('Tu ticket está listo', `Continúa tu postulación en ${channel}.`)], components: [] });
  });
}

async function sendNextQuestion(channel, app) {
  const answers = db.repo.getAnswers(app.id);
  const next = answers.find((a) => !a.answered_at);
  if (!next) return sendSummary(channel, app, answers);
  return channel.send({
    embeds: [questionEmbed(next, answers.length)],
    components: questionRow(app.id, !next.required),
  });
}

async function sendSummary(channel, app, answers) {
  await channel.send({ embeds: [summaryIntroEmbed(app)] });
  for (const group of groupEmbeds(answersEmbeds(answers, 'Tus respuestas'))) {
    await channel.send({ embeds: group, allowedMentions: { parse: [] } });
  }
  return channel.send({ embeds: [infoEmbed('¿Todo correcto?', 'Cuando envíes la postulación, el equipo revisor recibirá tu expediente completo.')], components: submitRow(app.id) });
}

async function submitApplication(interaction, appId) {
  const { guild, client, user } = interaction;
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    const answers = repo.getAnswers(appId);
    const missing = answers.find((a) => a.required && !a.answered_at);
    if (missing) throw new StateError('INVALID', `Aún falta responder la pregunta ${missing.position}.`);
    if (answers.some((a) => !a.answered_at)) throw new StateError('INVALID', 'Aún hay preguntas sin responder.');
    const app = repo.transition(appId, [STATUS.PREPARACION], STATUS.ENVIADA, user.id, 'Postulación enviada');
    await interaction.update({
      embeds: [successEmbed('Postulación enviada', `Tu postulación ${fmtId(app)} ha sido enviada al equipo. Te avisaremos de cualquier novedad por aquí y por mensaje directo.`)],
      components: [],
    });
    await safe('Publicar expediente', () => postDossier(client, guild, appId));
    await logApp(client, guild.id, app, { title: 'Formulario completado y enviado', color: COLORS.primary, actorId: user.id });
    return app;
  });
}

async function restartApplication(interaction, appId) {
  return withLock(`app:${appId}`, async () => {
    const repo = db.repo;
    repo.resetAnswers(appId);
    await interaction.update({ embeds: [infoEmbed('Respuestas reiniciadas', 'Empezamos de nuevo desde la primera pregunta.')], components: [] });
    const channel = interaction.channel ?? (await fetchChannelById(interaction.client, interaction.channelId));
    await sendNextQuestion(channel, repo.getApplication(appId));
  });
}

async function cancelApplication(interaction, appId) {
  const { guild, client, user } = interaction;
  const app = db.repo.getApplication(appId);
  if (!app || app.status !== STATUS.PREPARACION) throw new StateError('CONFLICT', app?.status);
  await interaction.update({ embeds: [infoEmbed('Postulación cancelada', 'Has cancelado tu postulación. Podrás iniciar otra cuando quieras.')], components: [] });
  // close() toma su propio bloqueo y revalida el estado de forma atómica.
  await reviewService.close(client, guild, appId, user.id, 'Cancelada por el postulante');
}

module.exports = {
  startApplication, sendNextQuestion, submitApplication, restartApplication, cancelApplication, findActive,
};
