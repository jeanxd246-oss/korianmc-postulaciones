'use strict';

require('dotenv').config();
const { deployCommands } = require('../src/handlers/deploy');

const { DISCORD_TOKEN: token, CLIENT_ID: clientId, DEV_GUILD_ID: guildId } = process.env;
if (!token || !clientId) {
  console.error('Faltan DISCORD_TOKEN y/o CLIENT_ID en el entorno (.env).');
  process.exit(1);
}
deployCommands({ token, clientId, guildId: guildId || undefined })
  .then((r) => console.log(`Comandos registrados: ${r.count} (${r.scope}).`))
  .catch((err) => { console.error('Error al registrar los comandos:', err.message); process.exit(1); });
