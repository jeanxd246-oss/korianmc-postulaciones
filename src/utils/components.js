'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { STATUS } = require('../config/constants');
const { clip } = require('./format');

const row = (...components) => new ActionRowBuilder().addComponents(...components);

function button(id, label, style, emoji, disabled = false) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}

const panelRow = () => [row(button('ap:start', 'Iniciar postulación', ButtonStyle.Primary, '📝'))];
const ackRow = () => [row(button('ap:ack', 'He leído los requisitos', ButtonStyle.Success, '✅'))];

function questionRow(appId, optional) {
  const items = [button(`ap:ans:${appId}`, 'Responder', ButtonStyle.Primary, '✍️')];
  if (optional) items.push(button(`ap:skip:${appId}`, 'Omitir', ButtonStyle.Secondary, '⏭️'));
  items.push(button(`ap:cancel:${appId}`, 'Cancelar', ButtonStyle.Danger));
  return [row(...items)];
}

const submitRow = (appId) => [row(
  button(`ap:submit:${appId}`, 'Enviar postulación', ButtonStyle.Success, '📨'),
  button(`ap:restart:${appId}`, 'Reiniciar respuestas', ButtonStyle.Secondary, '🔄'),
  button(`ap:cancel:${appId}`, 'Cancelar', ButtonStyle.Danger),
)];

const cancelConfirmRow = (appId) => [row(
  button(`ap:cx:${appId}`, 'Sí, cancelar postulación', ButtonStyle.Danger),
  button(`ap:keep:${appId}`, 'Continuar', ButtonStyle.Secondary),
)];

const infoReplyRow = (appId) => [row(button(`ap:replied:${appId}`, 'Ya respondí', ButtonStyle.Success, '📬'))];

function reviewRows(app) {
  const s = app.status;
  const closed = s === STATUS.CERRADA;
  const resolved = s === STATUS.ACEPTADA || s === STATUS.RECHAZADA;
  const pending = !closed && !resolved && s !== STATUS.PREPARACION;
  const id = app.id;
  return [
    row(
      button(`rv:accept:${id}`, 'Aceptar', ButtonStyle.Success, '✅', !pending),
      button(`rv:reject:${id}`, 'Rechazar', ButtonStyle.Danger, '⛔', !pending),
      button(`rv:info:${id}`, 'Solicitar información', ButtonStyle.Secondary, '❓', !pending),
    ),
    row(
      button(`rv:review:${id}`, 'Marcar para revisión', ButtonStyle.Primary, '🔎', !pending || s === STATUS.REVISION),
      button(`rv:note:${id}`, 'Añadir observación', ButtonStyle.Secondary, '📝', closed),
      button(`rv:close:${id}`, 'Cerrar ticket', ButtonStyle.Secondary, '🔒', closed),
    ),
  ];
}

// action: 'a' aceptar, 'r' rechazar, 'c' cerrar
function confirmRow(action, id) {
  const style = action === 'a' ? ButtonStyle.Success : ButtonStyle.Danger;
  const label = { a: 'Confirmar aceptación', r: 'Confirmar rechazo', c: 'Confirmar cierre' }[action];
  return [row(
    button(`rv:cf${action}:${id}`, label, style),
    button(`rv:no:${id}`, 'Cancelar', ButtonStyle.Secondary),
  )];
}

function pagerRow(scope, filter, page, pages) {
  return [row(
    button(`pg:${scope}:${filter}:${page - 1}`, 'Anterior', ButtonStyle.Secondary, '◀️', page <= 0),
    button(`pg:${scope}:${filter}:noop`, `${page + 1} / ${Math.max(pages, 1)}`, ButtonStyle.Secondary, null, true),
    button(`pg:${scope}:${filter}:${page + 1}`, 'Siguiente', ButtonStyle.Secondary, '▶️', page + 1 >= pages),
  )];
}

function textModal({ customId, title, label, style = TextInputStyle.Paragraph, required = true, max = 1000, value, placeholder }) {
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(clip(label, 45))
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(Math.min(Math.max(max, 1), 4000));
  if (value) input.setValue(clip(value, Math.min(max, 4000)));
  if (placeholder) input.setPlaceholder(clip(placeholder, 100));
  return new ModalBuilder().setCustomId(customId).setTitle(clip(title, 45)).addComponents(row(input));
}

module.exports = {
  button, panelRow, ackRow, questionRow, submitRow, cancelConfirmRow, infoReplyRow, reviewRows, confirmRow, pagerRow, textModal,
};
