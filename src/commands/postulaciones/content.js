'use strict';

const db = require('../../database');
const { StateError } = require('../../database');
const { LIMITS, COLORS } = require('../../config/constants');
const { requirementsListEmbed, questionsListEmbed, successEmbed } = require('../../utils/embeds');
const { say, sayError } = require('../../utils/respond');
const { cleanText, clampAnswerLength } = require('../../utils/validate');
const { logGuild } = require('../../services/logService');

const audit = (interaction, description) =>
  logGuild(interaction.client, interaction.guildId, { title: 'Configuración modificada', color: COLORS.primary, actorId: interaction.user.id, description });

async function guarded(interaction, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StateError) return sayError(interaction, 'No se pudo completar', err.code === 'NOT_FOUND' ? 'No existe ese número.' : 'Valor no válido.');
    throw err;
  }
}

// ───────── Requisitos ─────────
const reqList = (i) => say(i, { embeds: [requirementsListEmbed(db.repo.listRequirements(i.guildId))] });

async function reqAdd(i) {
  const text = cleanText(i.options.getString('texto', true), LIMITS.requirementMax);
  if (!text) return sayError(i, 'Texto vacío', 'Escribe el requisito.');
  if (db.repo.listRequirements(i.guildId).length >= LIMITS.maxRequirements) return sayError(i, 'Límite alcanzado', `Máximo ${LIMITS.maxRequirements} requisitos.`);
  const r = db.repo.addRequirement(i.guildId, text);
  await audit(i, `Requisito #${r.position} añadido.`);
  return say(i, { embeds: [successEmbed('Requisito añadido', `**${r.position}.** ${r.text}`)] });
}

async function reqEdit(i) {
  const text = cleanText(i.options.getString('texto', true), LIMITS.requirementMax);
  if (!text) return sayError(i, 'Texto vacío', 'Escribe el requisito.');
  return guarded(i, async () => {
    const r = db.repo.updateRequirement(i.guildId, i.options.getInteger('numero', true), text);
    await audit(i, `Requisito #${r.position} editado.`);
    return say(i, { embeds: [successEmbed('Requisito editado', `**${r.position}.** ${r.text}`)] });
  });
}

async function reqDelete(i) {
  return guarded(i, async () => {
    const r = db.repo.deleteRequirement(i.guildId, i.options.getInteger('numero', true));
    await audit(i, `Requisito eliminado: «${r.text}».`);
    return say(i, { embeds: [successEmbed('Requisito eliminado', r.text)] });
  });
}

// ───────── Preguntas ─────────
const qList = (i) => say(i, { embeds: [questionsListEmbed(db.repo.listQuestions(i.guildId))] });

async function qAdd(i) {
  const label = cleanText(i.options.getString('etiqueta', true), LIMITS.questionLabelMax);
  const text = cleanText(i.options.getString('texto', true), LIMITS.questionTextMax);
  if (!label || !text) return sayError(i, 'Datos incompletos', 'La etiqueta y el texto no pueden estar vacíos.');
  if (db.repo.listQuestions(i.guildId).length >= LIMITS.maxQuestions) return sayError(i, 'Límite alcanzado', `Máximo ${LIMITS.maxQuestions} preguntas.`);
  const required = i.options.getBoolean('obligatoria');
  const q = db.repo.addQuestion(i.guildId, {
    label, text, required: required === null ? true : required, max_length: clampAnswerLength(i.options.getInteger('largo') ?? LIMITS.answerDefaultMax),
  });
  await audit(i, `Pregunta #${q.position} añadida («${label}»).`);
  return say(i, { embeds: [successEmbed('Pregunta añadida', `**${q.position}.** ${q.text}`)] });
}

async function qEdit(i) {
  const label = i.options.getString('etiqueta');
  const text = i.options.getString('texto');
  const length = i.options.getInteger('largo');
  const required = i.options.getBoolean('obligatoria');
  const patch = {};
  if (label !== null) patch.label = cleanText(label, LIMITS.questionLabelMax);
  if (text !== null) patch.text = cleanText(text, LIMITS.questionTextMax);
  if (length !== null) patch.max_length = clampAnswerLength(length);
  if (required !== null) patch.required = required;
  if ((patch.label !== undefined && !patch.label) || (patch.text !== undefined && !patch.text)) return sayError(i, 'Datos incompletos', 'No pueden quedar vacíos.');
  if (!Object.keys(patch).length) return sayError(i, 'Nada que cambiar', 'Indica al menos un campo.');
  return guarded(i, async () => {
    const q = db.repo.updateQuestion(i.guildId, i.options.getInteger('numero', true), patch);
    await audit(i, `Pregunta #${q.position} editada.`);
    return say(i, { embeds: [successEmbed('Pregunta editada', `**${q.position}.** ${q.text}\nLas postulaciones ya iniciadas conservan su versión.`)] });
  });
}

async function qDelete(i) {
  return guarded(i, async () => {
    const q = db.repo.deleteQuestion(i.guildId, i.options.getInteger('numero', true));
    await audit(i, `Pregunta eliminada: «${q.label}».`);
    return say(i, { embeds: [successEmbed('Pregunta eliminada', q.text)] });
  });
}

async function qMove(i) {
  return guarded(i, async () => {
    const q = db.repo.moveQuestion(i.guildId, i.options.getInteger('numero', true), i.options.getInteger('posicion', true));
    await audit(i, `Pregunta «${q.label}» reordenada.`);
    return say(i, { embeds: [questionsListEmbed(db.repo.listQuestions(i.guildId))] });
  });
}

async function qReset(i) {
  if (!i.options.getBoolean('confirmar', true)) return sayError(i, 'Sin confirmar', 'Usa `confirmar: true` para restablecer las preguntas predeterminadas.');
  db.repo.resetQuestions(i.guildId);
  await audit(i, 'Preguntas restablecidas a las predeterminadas.');
  return say(i, { embeds: [questionsListEmbed(db.repo.listQuestions(i.guildId))] });
}

module.exports = { reqList, reqAdd, reqEdit, reqDelete, qList, qAdd, qEdit, qDelete, qMove, qReset };
