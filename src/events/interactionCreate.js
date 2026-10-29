'use strict';

const { Events } = require('discord.js');
const { handlers } = require('../interactions');
const { handleInteractionError } = require('../handlers/errorHandler');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command) await command.execute(interaction);
        return;
      }
      if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
        if (!interaction.inGuild()) return;
        const parts = interaction.customId.split(':');
        const handler = handlers.get(parts[0]);
        if (handler) await handler.handle(interaction, parts);
      }
    } catch (err) {
      await handleInteractionError(interaction, err);
    }
  },
};
