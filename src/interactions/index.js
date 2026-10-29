'use strict';

const apply = require('./apply');
const review = require('./review');
const pager = require('./pager');
const config = require('./config');

// Registro de manejadores por prefijo de customId (prefijo:acción:...).
const handlers = new Map([apply, review, pager, config].map((h) => [h.prefix, h]));

module.exports = { handlers };
