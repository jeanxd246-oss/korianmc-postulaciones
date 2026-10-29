'use strict';

const path = require('node:path');
const { openDatabase } = require('./connection');
const { migrate } = require('./migrations');
const { createRepo, StateError } = require('./repo');

const state = { db: null, repo: null };

function init(file) {
  const target = file || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'korianmc-postulaciones.sqlite');
  state.db = openDatabase(target);
  migrate(state.db);
  state.repo = createRepo(state.db);
  return state.repo;
}

function close() {
  if (state.db) state.db.close();
  state.db = null;
  state.repo = null;
}

module.exports = {
  init,
  close,
  StateError,
  get repo() {
    if (!state.repo) throw new Error('La base de datos no está inicializada.');
    return state.repo;
  },
  get db() { return state.db; },
};
