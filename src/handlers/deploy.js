'use strict';

const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./commandHandler');

async function deployCommands({ token, clientId, guildId }) {
  const body = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  const result = await rest.put(route, { body });
  return { count: result.length, scope: guildId ? `servidor ${guildId}` : 'global' };
}

module.exports = { deployCommands };
