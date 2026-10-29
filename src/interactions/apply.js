'use strict';

const { MessageFlags, TextInputStyle } = require('discord.js');
const db = require('../database');
const { StateError } = require('../database');
const { withLock } = require('../utils/lock');
const { STATUS } = require('../config/constants');
const { requirementsEmbed, errorEmbed, answeredEmbed, infoEmbed } = require('../utils/embeds');
const { ackRow, cancelConfirmRow, textModal } = require('../utils/components');
const { cleanText, validateAnswerByKey } = require('../utils/validate');
const { say, sayError } = require('../utils/respond');
const applicationService = require('../services/applicationService');
const reviewService = require('../services/reviewService');
const { fetchChannelById } = require('../services/discordUtil');

// Devuelve la postulación si pertenece a quien interactúa y a este servidor/canal.
async function ownApp(interaction, idStr) {
  const app = db.repo.getApplication(Number(idStr));
  if (!app || app.guild_id !== interaction.guildId) {
    await sayError(interaction, 'Postulación no encontrada', 'Esta postulación ya no existe.');
    return null;
  }
  if (app.user_id !== interaction.user.id) {
    await sayError(interaction, 'No es tu postulación', 'Solo el postulante puede usar estos botones.');
    return null;
  }
  if (app.channel_id && app.channel_id !== interaction.channelId) {
    await sayError(interaction, 'Canal incorrecto', 'Usa los botones desde tu ticket.');
    return null;
  }
  return app;
}

async function notPreparing(interaction, app) {
  return sayError(interaction, 'Acción no disponible', app.status === STATUS.CERRADA
    ? 'Esta postulación ya está cerrada.' : 'Esta postulación ya no está en preparación.');
}

async function handleStart(interaction) {
  const repo = db.repo;
  repo.ensureGuild(interaction.guildId);
  const active = repo.getActiveByUser(interaction.guildId, interaction.user.id);
  if (active && active.channel_id) {
    return say(interaction, { embeds: [errorEmbed('Ya tienes una postulación activa', `Continúa en <#${active.channel_id}>.`)] });
  }
  return say(interaction, { embeds: [requirementsEmbed(repo.listRequirements(interaction.guildId))], components: ackRow() });
}

async function handleAck(interaction) {
  await interaction.deferUpdate();
  return applicationService.startApplication(interaction);
}

async function handleAnswerButton(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  if (app.status !== STATUS.PREPARACION) return notPreparing(interaction, app);
  const row = db.repo.getAnswers(app.id).find((a) => !a.answered_at);
  if (!row) return say(interaction, { embeds: [infoEmbed('Todo respondido', 'Ya respondiste todas las preguntas. Pulsa **Enviar postulación**.')] });
  const modal = textModal({
    customId: `ap:mda:${app.id}:${row.position}`,
    title: `Pregunta ${row.position}`,
    label: row.label,
    style: row.max_length <= 100 ? TextInputStyle.Short : TextInputStyle.Paragraph,
    required: !!row.required,
    max: row.max_length,
    value: row.key === 'discord' ? interaction.user.username : undefined,
    placeholder: row.required ? undefined : 'Opcional',
  });
  return interaction.showModal(modal);
}

async function handleAnswerModal(interaction, idStr, posStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  if (app.status !== STATUS.PREPARACION) return notPreparing(interaction, app);
  const position = Number(posStr);
  const row = db.repo.getAnswers(app.id).find((a) => a.position === position);
  if (!row) return sayError(interaction, 'Pregunta no encontrada', 'Esta pregunta ya no existe.');
  if (row.answered_at) return sayError(interaction, 'Pregunta ya respondida', 'Ya registraste tu respuesta a esta pregunta.');
  const answer = cleanText(interaction.fields.getTextInputValue('value'), row.max_length);
  if (!answer && row.required) return sayError(interaction, 'Respuesta vacía', 'Esta pregunta es obligatoria.');
  if (answer) {
    const problem = validateAnswerByKey(row.key, answer);
    if (problem) return sayError(interaction, 'Respuesta no válida', problem);
  }
  try {
    await withLock(`app:${app.id}`, async () => { db.repo.saveAnswer(app.id, position, answer); });
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return sayError(interaction, 'No se pudo guardar', msg);
    throw err;
  }
  if (typeof interaction.isFromMessage === 'function' && interaction.isFromMessage()) {
    await interaction.update({ embeds: [answeredEmbed(row, answer)], components: [] });
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.deleteReply().catch(() => null);
  }
  const channel = interaction.channel ?? (await fetchChannelById(interaction.client, interaction.channelId));
  return applicationService.sendNextQuestion(channel, db.repo.getApplication(app.id));
}

async function handleSkip(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  if (app.status !== STATUS.PREPARACION) return notPreparing(interaction, app);
  const row = db.repo.getAnswers(app.id).find((a) => !a.answered_at);
  if (!row || row.required) return sayError(interaction, 'No se puede omitir', 'Esta pregunta es obligatoria.');
  try {
    await withLock(`app:${app.id}`, async () => { db.repo.saveAnswer(app.id, row.position, ''); });
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return sayError(interaction, 'No se pudo omitir', msg);
    throw err;
  }
  await interaction.update({ embeds: [answeredEmbed(row, '')], components: [] });
  const channel = interaction.channel ?? (await fetchChannelById(interaction.client, interaction.channelId));
  return applicationService.sendNextQuestion(channel, db.repo.getApplication(app.id));
}

async function handleSubmit(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  if (app.status !== STATUS.PREPARACION) return notPreparing(interaction, app);
  try {
    return await applicationService.submitApplication(interaction, app.id);
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return sayError(interaction, 'No se pudo enviar', err instanceof StateError && err.code === 'INVALID' ? err.detail : msg);
    throw err;
  }
}

async function handleRestart(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  if (app.status !== STATUS.PREPARACION) return notPreparing(interaction, app);
  return applicationService.restartApplication(interaction, app.id);
}

async function handleCancel(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  if (app.status !== STATUS.PREPARACION) return notPreparing(interaction, app);
  return say(interaction, {
    embeds: [infoEmbed('¿Cancelar tu postulación?', 'Se cerrará el ticket y tus respuestas dejarán de estar disponibles para edición. Podrás iniciar otra postulación más adelante.')],
    components: cancelConfirmRow(app.id),
  });
}

async function handleCancelConfirm(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  try {
    return await applicationService.cancelApplication(interaction, app.id);
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return sayError(interaction, 'No se pudo cancelar', msg);
    throw err;
  }
}

async function handleReplied(interaction, idStr) {
  const app = await ownApp(interaction, idStr);
  if (!app) return null;
  try {
    await reviewService.applicantReplied(interaction.client, interaction.guild, app.id, interaction.user.id);
  } catch (err) {
    const msg = reviewService.stateErrorMessage(err);
    if (msg) return sayError(interaction, 'No disponible', msg);
    throw err;
  }
  return interaction.update({ components: [] });
}

async function handle(interaction, parts) {
  const [, action, idStr, extra] = parts;
  switch (action) {
    case 'start': return handleStart(interaction);
    case 'ack': return handleAck(interaction);
    case 'ans': return handleAnswerButton(interaction, idStr);
    case 'mda': return handleAnswerModal(interaction, idStr, extra);
    case 'skip': return handleSkip(interaction, idStr);
    case 'submit': return handleSubmit(interaction, idStr);
    case 'restart': return handleRestart(interaction, idStr);
    case 'cancel': return handleCancel(interaction, idStr);
    case 'cx': return handleCancelConfirm(interaction, idStr);
    case 'keep': return interaction.update({ embeds: [infoEmbed('Todo sigue igual', 'Puedes continuar con tu postulación.')], components: [] });
    case 'replied': return handleReplied(interaction, idStr);
    default: return say(interaction, { embeds: [errorEmbed('Botón no reconocido', 'Esta acción ya no está disponible.')] });
  }
}

module.exports = { prefix: 'ap', handle };
