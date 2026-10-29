'use strict';

const db = require('../database');
const logger = require('../utils/logger');
const { logEmbed } = require('../utils/embeds');
const { COLORS } = require('../config/constants');
const { fetchChannelById } = require('./discordUtil');

async function log(client, guildId, embed) {
  try {
    const config = db.repo.getConfig(guildId);
    if (!config || !config.log_channel_id) return false;
    const channel = await fetchChannelById(client, config.log_channel_id);
    if (!channel || !channel.isTextBased()) return false;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    logger.warn(`No se pudo escribir en el canal de registros (${guildId}): ${err.message}`);
    return false;
  }
}

// Registro de eventos de la postulación. Nunca incluye respuestas privadas ni secretos.
function logApp(client, guildId, app, { title, color = COLORS.neutral, actorId, reason, extra = [] }) {
  const fields = [
    { name: 'Expediente', value: `#${String(app.number).padStart(4, '0')}`, inline: true },
    { name: 'Postulante', value: `<@${app.user_id}>`, inline: true },
  ];
  if (actorId) fields.push({ name: 'Responsable', value: `<@${actorId}>`, inline: true });
  if (reason) fields.push({ name: 'Motivo', value: reason });
  fields.push(...extra);
  return log(client, guildId, logEmbed({ title, color, fields }));
}

function logGuild(client, guildId, { title, color = COLORS.neutral, actorId, description, fields = [] }) {
  const f = [...fields];
  if (actorId) f.unshift({ name: 'Responsable', value: `<@${actorId}>`, inline: true });
  return log(client, guildId, logEmbed({ title, color, description, fields: f }));
}

module.exports = { log, logApp, logGuild };
