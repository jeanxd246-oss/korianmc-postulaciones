'use strict';

const crypto = require('node:crypto');
const { MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { errorEmbed } = require('../utils/embeds');
const { stateErrorMessage } = require('../services/reviewService');
const { logGuild } = require('../services/logService');
const { COLORS } = require('../config/constants');

// Códigos de Discord que no merecen respuesta al usuario (interacción caducada o ya respondida).
const SILENT_CODES = new Set([10062, 40060]);

async function handleInteractionError(interaction, err) {
  if (SILENT_CODES.has(err?.code)) {
    logger.warn(`Interacción no respondible (${err.code}): ${err.message}`);
    return;
  }
  const friendly = stateErrorMessage(err);
  let description = friendly;
  if (!friendly) {
    const ref = crypto.randomBytes(3).toString('hex');
    logger.error(`Error en interacción [${ref}] (${interaction.customId || interaction.commandName})`, err);
    description = `Ocurrió un error inesperado. Si persiste, avisa a un administrador indicando el código \`${ref}\`.`;
    if (interaction.guildId) {
      logGuild(interaction.client, interaction.guildId, {
        title: 'Error relevante', color: COLORS.danger, actorId: interaction.user?.id,
        fields: [{ name: 'Código', value: ref, inline: true }, { name: 'Origen', value: String(interaction.customId || interaction.commandName), inline: true },
          { name: 'Detalle', value: String(err.message).slice(0, 500) }],
      }).catch(() => null);
    }
  }
  const payload = { embeds: [errorEmbed('No se pudo completar la acción', description)], components: [], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (e) {
    logger.warn(`No se pudo notificar el error al usuario: ${e.message}`);
  }
}

module.exports = { handleInteractionError };
