'use strict';

const { ChannelType, PermissionFlagsBits: P, TextInputStyle, MessageFlags } = require('discord.js');
const db = require('../../database');
const { TEXT_KEYS, LIMITS, COLORS } = require('../../config/constants');
const { panelEmbed, configEmbed, successEmbed, warnEmbed, errorEmbed } = require('../../utils/embeds');
const { panelRow, textModal } = require('../../utils/components');
const { say, sayError, finish } = require('../../utils/respond');
const { logGuild } = require('../../services/logService');
const { fetchChannel } = require('../../services/discordUtil');

async function me(guild) {
  return guild.members.me ?? guild.members.fetchMe();
}

const audit = (interaction, description) =>
  logGuild(interaction.client, interaction.guildId, {
    title: 'Configuración modificada', color: COLORS.primary, actorId: interaction.user.id, description,
  });

async function publishPanel(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const repo = db.repo;
  const config = repo.ensureGuild(interaction.guildId);
  const channel = interaction.options.getChannel('canal') ?? interaction.channel;
  if (!channel || !channel.isTextBased() || channel.isThread()) {
    return finish(interaction, { embeds: [errorEmbed('Canal no válido', 'Elige un canal de texto.')] });
  }
  const perms = channel.permissionsFor(await me(interaction.guild));
  if (!perms || !perms.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
    return finish(interaction, { embeds: [errorEmbed('Faltan permisos', `Necesito ver el canal, enviar mensajes e insertar enlaces en ${channel}.`)] });
  }
  const message = await channel.send({ embeds: [panelEmbed(config, repo.listRequirements(interaction.guildId))], components: panelRow() });
  // Retira el panel anterior para que no queden dos activos.
  if (config.panel_channel_id && config.panel_message_id) {
    const old = await fetchChannel(interaction.guild, config.panel_channel_id);
    if (old) await old.messages.delete(config.panel_message_id).catch(() => null);
  }
  repo.updateConfig(interaction.guildId, { panel_channel_id: channel.id, panel_message_id: message.id });
  await audit(interaction, `Panel publicado en <#${channel.id}>.`);
  const warnings = [];
  if (!config.category_id) warnings.push('• No hay categoría de tickets configurada (`/postulaciones configurar categoria`).');
  if (!config.reviewer_roles.length && !config.admin_roles.length) warnings.push('• No hay roles revisores configurados (`/postulaciones configurar revisores`).');
  if (!config.log_channel_id) warnings.push('• No hay canal de registros (`/postulaciones configurar logs`).');
  const embeds = [successEmbed('Panel publicado', `El panel se publicó en ${channel}.`)];
  if (warnings.length) embeds.push(warnEmbed('Configuración recomendada pendiente', warnings.join('\n')));
  return finish(interaction, { embeds });
}

async function viewConfig(interaction) {
  const repo = db.repo;
  const config = repo.ensureGuild(interaction.guildId);
  return say(interaction, {
    embeds: [configEmbed(config, { questions: repo.listQuestions(interaction.guildId).length, requirements: repo.listRequirements(interaction.guildId).length })],
  });
}

async function setCategory(interaction) {
  const category = interaction.options.getChannel('categoria', true);
  if (category.type !== ChannelType.GuildCategory) return sayError(interaction, 'Categoría no válida', 'Selecciona una categoría.');
  const perms = category.permissionsFor(await me(interaction.guild));
  const warn = perms && perms.has([P.ManageChannels, P.ViewChannel]) ? '' : '\nAviso: el bot no tiene «Gestionar canales» en esa categoría.';
  db.repo.updateConfig(interaction.guildId, { category_id: category.id });
  await audit(interaction, `Categoría de tickets: ${category}.`);
  return say(interaction, { embeds: [successEmbed('Categoría configurada', `Los tickets se crearán en ${category}.${warn}`)] });
}

async function setLogs(interaction) {
  const channel = interaction.options.getChannel('canal', true);
  const perms = channel.permissionsFor(await me(interaction.guild));
  if (!perms || !perms.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
    return sayError(interaction, 'Faltan permisos', `Necesito ver el canal, enviar mensajes e insertar enlaces en ${channel}.`);
  }
  db.repo.updateConfig(interaction.guildId, { log_channel_id: channel.id });
  await audit(interaction, `Canal de registros: ${channel}.`);
  return say(interaction, { embeds: [successEmbed('Canal de registros configurado', `Los registros se enviarán a ${channel}.`)] });
}

async function setReview(interaction) {
  const channel = interaction.options.getChannel('canal');
  if (!channel) {
    db.repo.updateConfig(interaction.guildId, { review_channel_id: null });
    await audit(interaction, 'Canal de revisión eliminado: los expedientes se publican en el ticket.');
    return say(interaction, { embeds: [successEmbed('Canal de revisión eliminado', 'Los expedientes se publicarán dentro del ticket (sin observaciones internas visibles).')] });
  }
  const perms = channel.permissionsFor(await me(interaction.guild));
  if (!perms || !perms.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])) {
    return sayError(interaction, 'Faltan permisos', `Necesito ver el canal, enviar mensajes e insertar enlaces en ${channel}.`);
  }
  db.repo.updateConfig(interaction.guildId, { review_channel_id: channel.id });
  await audit(interaction, `Canal de revisión: ${channel}.`);
  return say(interaction, { embeds: [successEmbed('Canal de revisión configurado', `Los expedientes con observaciones e historial se publicarán en ${channel}. Asegúrate de que solo el equipo pueda verlo.`)] });
}

async function setRole(interaction, column, label) {
  const action = interaction.options.getString('accion', true);
  const role = interaction.options.getRole('rol', true);
  const config = db.repo.ensureGuild(interaction.guildId);
  if (role.id === interaction.guildId) return sayError(interaction, 'Rol no válido', 'No puedes usar @everyone.');
  const list = new Set(config[column]);
  if (action === 'añadir') {
    if (list.size >= 10 && !list.has(role.id)) return sayError(interaction, 'Límite alcanzado', 'Máximo 10 roles.');
    list.add(role.id);
  } else list.delete(role.id);
  db.repo.updateConfig(interaction.guildId, { [column]: [...list] });
  await audit(interaction, `${label}: ${action === 'añadir' ? 'añadido' : 'quitado'} ${role}.`);
  return say(interaction, { embeds: [successEmbed(`${label} actualizados`, `Rol ${role} ${action === 'añadir' ? 'añadido' : 'quitado'}. Afecta a los tickets nuevos.`)] });
}

async function setClose(interaction) {
  const seconds = interaction.options.getInteger('segundos', true);
  db.repo.updateConfig(interaction.guildId, { close_delete_seconds: seconds });
  await audit(interaction, seconds > 0 ? `Cierre: eliminar canal tras ${seconds} s.` : 'Cierre: conservar el canal bloqueado.');
  return say(interaction, { embeds: [successEmbed('Cierre configurado', seconds > 0 ? `El canal se eliminará ${seconds} s después de cerrar el ticket.` : 'El canal se conservará bloqueado tras cerrar el ticket.')] });
}

async function setNotifications(interaction) {
  const dm = interaction.options.getBoolean('mensajes_directos');
  const ping = interaction.options.getBoolean('mencionar_revisores');
  const patch = {};
  if (dm !== null) patch.dm_notifications = dm;
  if (ping !== null) patch.ping_reviewers = ping;
  if (!Object.keys(patch).length) return sayError(interaction, 'Nada que cambiar', 'Indica al menos una opción.');
  const config = db.repo.updateConfig(interaction.guildId, patch);
  await audit(interaction, `Notificaciones: MD ${config.dm_notifications ? 'sí' : 'no'}, mención a revisores ${config.ping_reviewers ? 'sí' : 'no'}.`);
  return say(interaction, { embeds: [successEmbed('Notificaciones actualizadas', `Mensajes directos: **${config.dm_notifications ? 'sí' : 'no'}**\nMencionar revisores: **${config.ping_reviewers ? 'sí' : 'no'}**`)] });
}

async function editText(interaction) {
  const key = interaction.options.getString('tipo', true);
  if (!TEXT_KEYS[key]) return sayError(interaction, 'Texto no válido', 'Elige uno de la lista.');
  const config = db.repo.ensureGuild(interaction.guildId);
  const { textOf } = require('../../utils/embeds');
  return interaction.showModal(textModal({
    customId: `cfg:text:${key}`, title: TEXT_KEYS[key], label: 'Texto (vacío = predeterminado)',
    style: TextInputStyle.Paragraph, required: false, max: LIMITS.textMax, value: textOf(config, key),
  }));
}

module.exports = { publishPanel, viewConfig, setCategory, setLogs, setReview, setRole, setClose, setNotifications, editText };
