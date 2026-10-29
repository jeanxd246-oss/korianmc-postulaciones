'use strict';

const db = require('../database');
const { PENDING_STATUSES, LIMITS } = require('../config/constants');
const { queueEmbed } = require('../utils/embeds');
const { pagerRow } = require('../utils/components');

const FILTERS = {
  pendientes: { label: 'Pendientes', statuses: PENDING_STATUSES },
  enviada: { label: 'Enviadas', statuses: ['enviada'] },
  revision: { label: 'En revisión', statuses: ['revision'] },
  info_solicitada: { label: 'Información solicitada', statuses: ['info_solicitada'] },
  aceptada: { label: 'Aceptadas', statuses: ['aceptada'] },
  rechazada: { label: 'Rechazadas', statuses: ['rechazada'] },
  cerrada: { label: 'Cerradas', statuses: ['cerrada'] },
};

function buildQueue(guildId, filterKey, page) {
  const filter = FILTERS[filterKey] || FILTERS.pendientes;
  const key = FILTERS[filterKey] ? filterKey : 'pendientes';
  const total = db.repo.countApplications(guildId, filter.statuses);
  const pages = Math.max(Math.ceil(total / LIMITS.pageSize), 1);
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const apps = db.repo.listApplications(guildId, filter.statuses, LIMITS.pageSize, safePage * LIMITS.pageSize);
  return {
    embeds: [queueEmbed(apps, { total, page: safePage, pages, label: filter.label })],
    components: pages > 1 ? pagerRow('rv', key, safePage, pages) : [],
  };
}

module.exports = { buildQueue, FILTERS };
