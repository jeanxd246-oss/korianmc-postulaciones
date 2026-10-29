'use strict';

const { ChannelType, PermissionFlagsBits: P, OverwriteType } = require('discord.js');
const { slugName, fmtId } = require('../utils/format');
const { fetchChannel } = require('./discordUtil');

const MEMBER_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const STAFF_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const BOT_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks];

// Permisos mínimos: @everyone sin acceso; postulante, equipo y bot con lo imprescindible.
function buildOverwrites(guild, config, userId, botId) {
  const overwrites = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: userId, type: OverwriteType.Member, allow: MEMBER_ALLOW },
    { id: botId, type: OverwriteType.Member, allow: BOT_ALLOW },
  ];
  const roleIds = new Set([...(config.reviewer_roles || []), ...(config.admin_roles || [])]);
  for (const id of roleIds) {
    if (id === guild.roles.everyone.id) continue;
    if (!guild.roles.cache.has(id)) continue;
    overwrites.push({ id, type: OverwriteType.Role, allow: STAFF_ALLOW });
  }
  return overwrites;
}

async function createTicketChannel(client, guild, config, app, user) {
  const category = config.category_id ? await fetchChannel(guild, config.category_id) : null;
  const parent = category && category.type === ChannelType.GuildCategory ? category.id : undefined;
  return guild.channels.create({
    name: `postulacion-${slugName(user.username)}`,
    type: ChannelType.GuildText,
    parent,
    topic: `Postulación ${fmtId(app)} • ID de usuario ${user.id}`,
    permissionOverwrites: buildOverwrites(guild, config, user.id, client.user.id),
    reason: `Postulación ${fmtId(app)} de ${user.tag ?? user.username}`,
  });
}

// El postulante conserva la lectura pero ya no puede escribir.
async function lockApplicant(channel, userId) {
  await channel.permissionOverwrites.edit(userId, { SendMessages: false, AttachFiles: false }, { reason: 'Ticket cerrado' });
}

async function unlockApplicant(channel, userId) {
  await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }, { reason: 'Ticket reabierto' });
}

module.exports = { buildOverwrites, createTicketChannel, lockApplicant, unlockApplicant };
