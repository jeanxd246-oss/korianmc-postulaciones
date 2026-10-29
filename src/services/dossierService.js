'use strict';

const db = require('../database');
const { dossierEmbed, answersEmbeds, groupEmbeds } = require('../utils/embeds');
const { reviewRows } = require('../utils/components');
const { fetchChannel } = require('./discordUtil');
const { safe } = require('./discordUtil');

async function resolveTarget(guild, config, app) {
  if (config.review_channel_id) {
    const review = await fetchChannel(guild, config.review_channel_id);
    if (review && review.isTextBased()) return review;
  }
  return app.channel_id ? fetchChannel(guild, app.channel_id) : null;
}

function buildPayload(app, config) {
  const repo = db.repo;
  const internal = !!app.dossier_channel_id && app.dossier_channel_id !== app.channel_id;
  return {
    embeds: [dossierEmbed(app, {
      requirements: repo.listRequirements(app.guild_id),
      notes: repo.listNotes(app.id),
      history: repo.listHistory(app.id),
      includePrivate: internal,
    })],
    components: reviewRows(app),
  };
}

// Publica el expediente (con botones de revisión) y las respuestas completas.
async function postDossier(client, guild, appId) {
  const repo = db.repo;
  let app = repo.getApplication(appId);
  const config = repo.getConfig(guild.id);
  const target = await resolveTarget(guild, config, app);
  if (!target) return null;
  // Fijamos primero el destino para que buildPayload sepa si es un canal interno.
  app = { ...app, dossier_channel_id: target.id };
  const roles = config.ping_reviewers ? (config.reviewer_roles || []) : [];
  const payload = buildPayload(app, config);
  const message = await target.send({
    content: roles.length ? `${roles.map((r) => `<@&${r}>`).join(' ')} Nueva postulación para revisar.` : undefined,
    ...payload,
    allowedMentions: { roles },
  });
  repo.setDossier(appId, target.id, message.id);
  const answers = repo.getAnswers(appId);
  for (const group of groupEmbeds(answersEmbeds(answers, 'Respuestas del postulante'))) {
    await safe('Enviar respuestas del expediente', () => target.send({ embeds: group, allowedMentions: { parse: [] } }));
  }
  return message;
}

async function refreshDossier(client, guild, appId) {
  const repo = db.repo;
  const app = repo.getApplication(appId);
  if (!app || !app.dossier_message_id || !app.dossier_channel_id) return false;
  const config = repo.getConfig(guild.id);
  const channel = await fetchChannel(guild, app.dossier_channel_id);
  if (!channel) return false;
  const result = await safe('Actualizar expediente', async () => {
    const message = await channel.messages.fetch(app.dossier_message_id);
    await message.edit({ ...buildPayload(app, config), allowedMentions: { parse: [] } });
    return true;
  });
  return !!result;
}

module.exports = { postDossier, refreshDossier, resolveTarget };
