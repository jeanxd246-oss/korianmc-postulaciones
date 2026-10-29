'use strict';

function clip(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

// Marca de tiempo de Discord. ms = milisegundos desde epoch.
function ts(ms, style = 'f') {
  if (!ms) return '—';
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

function fmtId(app) {
  return `#${String(app.number).padStart(4, '0')}`;
}

function slugName(name) {
  const s = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'usuario';
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

module.exports = { clip, ts, fmtId, slugName, formatDuration };
