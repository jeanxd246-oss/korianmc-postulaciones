'use strict';

const db = require('../../database');
const { sayError } = require('../../utils/respond');

// Resuelve el expediente por la opción "id" o, si falta, por el canal actual.
async function resolveApp(interaction, { allowChannel = true } = {}) {
  const number = interaction.options.getInteger('id');
  let app = null;
  if (number !== null) app = db.repo.getByNumber(interaction.guildId, number);
  else if (allowChannel) app = db.repo.getByChannel(interaction.channelId);
  if (!app || app.guild_id !== interaction.guildId) {
    await sayError(interaction, 'Expediente no encontrado',
      number !== null ? `No existe la postulación #${number} en este servidor.` : 'Indica el ID del expediente o usa el comando dentro de un ticket.');
    return null;
  }
  return app;
}

module.exports = { resolveApp };
