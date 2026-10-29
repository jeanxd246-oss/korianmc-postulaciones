'use strict';

const db = require('../database');
const { getAccess } = require('../utils/permissions');
const { deny } = require('../utils/respond');
const { buildQueue } = require('../services/queueService');

// pg:rv:<filtro>:<página>
async function handle(interaction, parts) {
  const [, scope, filter, pageStr] = parts;
  const config = db.repo.ensureGuild(interaction.guildId);
  if (!getAccess(interaction, config).reviewer) return deny(interaction);
  if (scope !== 'rv' || pageStr === 'noop') return interaction.deferUpdate();
  const page = Number.parseInt(pageStr, 10);
  return interaction.update(buildQueue(interaction.guildId, filter, Number.isNaN(page) ? 0 : page));
}

module.exports = { prefix: 'pg', handle };
