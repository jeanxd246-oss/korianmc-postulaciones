'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Carga cada comando: src/commands/<nombre>.js o src/commands/<carpeta>/index.js (exporta { data, execute }).
function loadCommands() {
  const dir = path.join(__dirname, '..', 'commands');
  const commands = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = entry.isDirectory() ? path.join(dir, entry.name, 'index.js') : path.join(dir, entry.name);
    if (!target.endsWith('.js') || !fs.existsSync(target)) continue;
    const mod = require(target);
    if (!mod.data || typeof mod.execute !== 'function') continue;
    commands.set(mod.data.name, mod);
  }
  return commands;
}

module.exports = { loadCommands };
