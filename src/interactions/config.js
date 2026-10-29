'use strict';

const db = require('../database');
const { TEXT_KEYS, LIMITS, COLORS } = require('../config/constants');
const { successEmbed } = require('../utils/embeds');
const { getAccess } = require('../utils/permissions');
const { cleanText } = require('../utils/validate');
const { say, deny, sayError } = require('../utils/respond');
const { logGuild } = require('../services/logService');

// cfg:text:<clave> (modal de textos personalizados)
async function handle(interaction, parts) {
  const [, action, key] = parts;
  const config = db.repo.ensureGuild(interaction.guildId);
  if (!getAccess(interaction, config).admin) return deny(interaction);
  if (action !== 'text' || !TEXT_KEYS[key]) return sayError(interaction, 'Acción no reconocida', 'Este formulario ya no es válido.');
  const value = cleanText(interaction.fields.getTextInputValue('value'), LIMITS.textMax);
  const texts = { ...config.texts };
  if (value) texts[key] = value;
  else delete texts[key];
  db.repo.updateConfig(interaction.guildId, { texts });
  await logGuild(interaction.client, interaction.guildId, {
    title: 'Configuración modificada', color: COLORS.primary, actorId: interaction.user.id,
    description: `Texto «${TEXT_KEYS[key]}» ${value ? 'actualizado' : 'restablecido al valor predeterminado'}.`,
  });
  return say(interaction, {
    embeds: [successEmbed('Texto guardado', value ? `Se actualizó «${TEXT_KEYS[key]}». Vuelve a publicar el panel con \`/postulaciones panel\` si afecta al panel.` : `«${TEXT_KEYS[key]}» vuelve al texto predeterminado.`)],
  });
}

module.exports = { prefix: 'cfg', handle };
