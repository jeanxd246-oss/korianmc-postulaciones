'use strict';

// Verificación de arranque: ejecuta "npm run check" tras instalar dependencias.
const assert = require('node:assert/strict');
const { loadCommands } = require('../src/handlers/commandHandler');
const { handlers } = require('../src/interactions');
const database = require('../src/database');
const { reviewRows, questionRow, submitRow, confirmRow, pagerRow, cancelConfirmRow, infoReplyRow, panelRow, ackRow } = require('../src/utils/components');
const E = require('../src/utils/embeds');

const commands = loadCommands();
assert.ok(commands.has('postulaciones'), 'Falta el comando /postulaciones');
const json = commands.get('postulaciones').data.toJSON();
assert.ok(json.options.length <= 25, 'Demasiadas opciones de primer nivel');
console.log(`✔ Comando /postulaciones válido (${json.options.length} entradas de primer nivel)`);

const { routes } = require('../src/commands/postulaciones');
const declared = new Set();
for (const o of json.options) {
  if (o.type === 1) declared.add(o.name);
  else for (const s of o.options) declared.add(`${o.name}/${s.name}`);
}
for (const r of declared) assert.ok(routes[r], `Subcomando sin manejador: ${r}`);
for (const r of Object.keys(routes)) assert.ok(declared.has(r), `Manejador sin subcomando: ${r}`);
console.log(`✔ ${declared.size} subcomandos con manejador`);

for (const p of ['ap', 'rv', 'pg', 'cfg']) assert.ok(handlers.has(p), `Falta el manejador ${p}`);
console.log('✔ Manejadores de interacciones registrados');

const app = { id: 123456, status: 'revision', number: 7 };
const ids = [panelRow(), ackRow(), questionRow(app.id, true), submitRow(app.id), confirmRow('a', app.id), cancelConfirmRow(app.id), infoReplyRow(app.id), pagerRow('rv', 'info_solicitada', 1, 3), reviewRows(app)]
  .flat().flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
for (const id of ids) assert.ok(id && id.length <= 100, `custom_id inválido: ${id}`);
console.log(`✔ ${ids.length} botones con custom_id válido`);

database.init(':memory:');
const repo = database.repo;
repo.ensureGuild('1');
const a = repo.createApplication('1', '2', 'prueba');
assert.equal(a.number, 1);
E.panelEmbed(repo.getConfig('1'), []).toJSON();
E.statsEmbed(repo.stats('1'), 'Prueba').toJSON();
E.dossierEmbed(a, { requirements: [], notes: [], history: repo.listHistory(a.id) }).toJSON();
console.log(`✔ Base de datos y embeds correctos (${database.db.engine || 'sqlite'})`);
database.close();
console.log('\nTodo correcto. Puedes iniciar el bot con: npm start');
