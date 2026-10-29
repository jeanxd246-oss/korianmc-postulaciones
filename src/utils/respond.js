'use strict';

const { MessageFlags } = require('discord.js');
const { errorEmbed } = require('./embeds');

// Respuesta efímera: reply si no se respondió, followUp si ya se respondió o aplazó.
async function say(interaction, payload) {
  const p = { ...payload, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(p);
  return interaction.reply(p);
}

// Cierra una interacción aplazada con editReply; si no se aplazó, responde de forma efímera.
async function finish(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

const sayError = (interaction, title, description) =>
  say(interaction, { embeds: [errorEmbed(title, description)], components: [] });

const deny = (interaction) =>
  sayError(interaction, 'Sin permisos', 'No tienes permiso para realizar esta acción.');

async function sendGroups(interaction, groups) {
  for (const g of groups) await interaction.followUp({ embeds: g, flags: MessageFlags.Ephemeral });
}

module.exports = { say, finish, sayError, deny, sendGroups };
