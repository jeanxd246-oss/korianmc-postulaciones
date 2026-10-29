'use strict';

const db = require('../database');
const logger = require('../utils/logger');
const { LIMITS } = require('../config/constants');
const reviewService = require('./reviewService');
const { safe } = require('./discordUtil');

// Una sola tarea ligera: borra canales programados y cierra postulaciones abandonadas.
async function sweep(client) {
  const repo = db.repo;
  for (const app of repo.listDueDeletions(Date.now())) {
    const guild = client.guilds.cache.get(app.guild_id);
    if (!guild) continue;
    await safe(`Eliminar canal ${app.channel_id}`, async () => {
      const channel = await guild.channels.fetch(app.channel_id).catch(() => null);
      if (channel) await channel.delete('Ticket cerrado: eliminación programada');
      repo.clearChannel(app.id);
    });
  }
  for (const app of repo.listAbandoned(Date.now() - LIMITS.abandonedAfterMs)) {
    const guild = client.guilds.cache.get(app.guild_id);
    if (!guild) continue;
    await safe(`Cerrar postulación abandonada ${app.id}`, () =>
      reviewService.close(client, guild, app.id, client.user.id, 'Cerrada por inactividad: el formulario no se completó'));
  }
}

function start(client) {
  const run = () => sweep(client).catch((err) => logger.error('Error en el mantenimiento periódico', err));
  run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { start, sweep };
