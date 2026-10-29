'use strict';

const fs = require('node:fs');
const path = require('node:path');

function registerEvents(client) {
  const dir = path.join(__dirname, '..', 'events');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(dir, file));
    if (!event.name || typeof event.execute !== 'function') continue;
    if (event.once) client.once(event.name, (...args) => event.execute(...args));
    else client.on(event.name, (...args) => event.execute(...args));
  }
}

module.exports = { registerEvents };
