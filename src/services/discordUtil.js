'use strict';

const logger = require('../utils/logger');

async function fetchChannel(guild, id) {
  if (!id) return null;
  try {
    return (await guild.channels.fetch(id)) || null;
  } catch {
    return null;
  }
}

async function fetchChannelById(client, id) {
  if (!id) return null;
  try {
    return (await client.channels.fetch(id)) || null;
  } catch {
    return null;
  }
}

// Ejecuta una operación de Discord sin romper el flujo principal.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`${label}: ${err.message}`);
    return null;
  }
}

module.exports = { fetchChannel, fetchChannelById, safe };
