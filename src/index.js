'use strict';

require('dotenv').config();
const path = require('node:path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const logger = require('./utils/logger');
const database = require('./database');
const { loadCommands } = require('./handlers/commandHandler');
const { registerEvents } = require('./handlers/eventHandler');

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    logger.error('Falta DISCORD_TOKEN. Copia .env.example a .env y complétalo (o defínelo en las variables de entorno del hosting).');
    process.exit(1);
  }
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'korianmc-postulaciones.sqlite');
  database.init(dbPath);
  logger.info(`Base de datos lista (${database.db.engine || 'sqlite'}): ${dbPath}`);

  // Solo el intent "Guilds": no se necesitan intents privilegiados y se ahorra RAM.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection(loadCommands());
  registerEvents(client);

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} recibido: cerrando de forma segura...`);
    try { await client.destroy(); } catch { /* ignorar */ }
    database.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Promesa rechazada sin capturar', reason instanceof Error ? reason : new Error(String(reason))));
  process.on('uncaughtException', (err) => logger.error('Excepción no capturada', err));

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
  logger.error('No se pudo iniciar el bot', err);
  process.exit(1);
});
