'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const database = require('../src/database');

const source = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'korianmc-postulaciones.sqlite');
if (!fs.existsSync(source)) { console.error(`No existe la base de datos: ${source}`); process.exit(1); }
const dir = path.join(path.dirname(path.resolve(source)), 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `postulaciones-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
database.init(source);
// VACUUM INTO genera una copia consistente aunque el bot esté en marcha.
database.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
database.close();
console.log(`Copia de seguridad creada: ${target}`);
