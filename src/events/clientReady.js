'use strict';

const { Events } = require('discord.js');
const logger = require('../utils/logger');
const maintenance = require('../services/maintenance');
const { deployCommands } = require('../handlers/deploy');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Conectado como ${client.user.tag} en ${client.guilds.cache.size} servidor(es).`);
    if (String(process.env.AUTO_DEPLOY_COMMANDS).toLowerCase() === 'true') {
      try {
        const r = await deployCommands({ token: process.env.DISCORD_TOKEN, clientId: client.user.id, guildId: process.env.DEV_GUILD_ID || undefined });
        logger.info(`Comandos registrados automáticamente: ${r.count} (${r.scope}).`);
      } catch (err) {
        logger.error('No se pudieron registrar los comandos automáticamente', err);
      }
    }
    maintenance.start(client);
  },
};
