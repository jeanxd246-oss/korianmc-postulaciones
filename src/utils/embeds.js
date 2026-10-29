'use strict';

const { EmbedBuilder } = require('discord.js');
const {
  COLORS, BRAND, SEP, STATUS_META, DEFAULT_TEXTS, TEXT_KEYS, LIMITS,
} = require('../config/constants');
const { clip, ts, fmtId, formatDuration } = require('./format');

const base = (color = COLORS.primary) =>
  new EmbedBuilder().setColor(color).setFooter({ text: `${BRAND.name} • ${BRAND.community}` }).setTimestamp();

const textOf = (config, key) => (config && config.texts && config.texts[key]) || DEFAULT_TEXTS[key];
const statusLabel = (s) => `${STATUS_META[s]?.emoji ?? '•'} ${STATUS_META[s]?.label ?? s}`;

// ───────── Genéricos ─────────
const infoEmbed = (title, description) => base(COLORS.neutral).setTitle(title).setDescription(clip(description, 4000));
const successEmbed = (title, description) => base(COLORS.success).setTitle(`✅ ${title}`).setDescription(clip(description, 4000));
const errorEmbed = (title, description) => base(COLORS.danger).setTitle(`⛔ ${title}`).setDescription(clip(description, 4000));
const warnEmbed = (title, description) => base(COLORS.warning).setTitle(`⚠️ ${title}`).setDescription(clip(description, 4000));

// ───────── Panel y requisitos ─────────
function panelEmbed(config, requirements) {
  const reqText = requirements.length
    ? clip(requirements.map((r) => `• ${r.text}`).join('\n'), 1000)
    : 'El equipo aún no ha publicado requisitos específicos. Si tienes dudas, consúltalas con el staff.';
  return base(COLORS.primary)
    .setTitle('Sistema de Postulaciones | KorianMC')
    .setDescription(`${textOf(config, 'panel_description')}\n${SEP}`)
    .addFields(
      { name: '📋 Requisitos generales', value: reqText },
      { name: '🧭 Proceso de selección', value: clip(textOf(config, 'process'), 1000) },
      { name: '📜 Normas para postulantes', value: clip(textOf(config, 'rules'), 1000) },
      { name: '⚠️ Importante', value: 'Enviar una postulación **no garantiza la aceptación**.' },
      { name: '🚀 Cómo empezar', value: 'Pulsa **Iniciar postulación**, revisa los requisitos y confirma que los has leído.' },
    );
}

function requirementsEmbed(requirements) {
  const body = requirements.length
    ? requirements.map((r, i) => `**${i + 1}.** ${r.text}`).join('\n')
    : 'No hay requisitos específicos configurados actualmente.';
  return base(COLORS.primary)
    .setTitle('📋 Requisitos de la postulación')
    .setDescription(`${body}\n${SEP}\nAl continuar confirmas que has leído y entiendes lo anterior. Se creará un canal privado para tu postulación.`);
}

function welcomeEmbed(config, app) {
  return base(COLORS.primary)
    .setTitle(`Bienvenido a tu postulación ${fmtId(app)}`)
    .setDescription(`${textOf(config, 'welcome')}\n${SEP}`)
    .addFields(
      { name: 'Privacidad', value: 'Este canal solo es visible para ti y para el equipo autorizado.' },
      { name: 'Guardado', value: 'Tus respuestas quedan guardadas aunque cierres Discord o el bot se reinicie.' },
    );
}

// ───────── Preguntas ─────────
function progressBar(done, total) {
  const size = 12;
  const filled = total ? Math.round((done / total) * size) : 0;
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} ${done}/${total}`;
}

function questionEmbed(row, total) {
  return base(COLORS.primary)
    .setTitle(`Pregunta ${row.position} de ${total}`)
    .setDescription(`${SEP}\n**${row.question_text}**\n${SEP}`)
    .addFields(
      { name: 'Tipo', value: row.required ? 'Obligatoria' : 'Opcional (puedes omitirla)', inline: true },
      { name: 'Límite', value: `${row.max_length} caracteres`, inline: true },
      { name: 'Progreso', value: progressBar(row.position - 1, total) },
    );
}

function answeredEmbed(row, answer) {
  return base(COLORS.neutral)
    .setTitle(`✔ Pregunta ${row.position} registrada`)
    .setDescription(`**${clip(row.label, 100)}**\n${answer ? clip(answer, 800) : '*Omitida*'}`);
}

function answerBlock(a) {
  let body;
  if (!a.answered_at) body = '*Pendiente*';
  else if (!a.answer) body = '*Omitida (opcional)*';
  else body = clip(a.answer, LIMITS.answerMaxAllowed);
  return `**${a.position}. ${a.label}**\n${body}`;
}

function answersEmbeds(answers, title) {
  const chunks = [];
  let cur = '';
  for (const a of answers) {
    const block = answerBlock(a);
    if (cur && cur.length + block.length + 2 > 3800) { chunks.push(cur); cur = block; }
    else cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) chunks.push(cur);
  if (!chunks.length) chunks.push('*Sin respuestas.*');
  return chunks.map((c, i) =>
    base(COLORS.primary).setTitle(chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title).setDescription(c));
}

function summaryIntroEmbed(app) {
  return base(COLORS.primary)
    .setTitle(`📄 Resumen de tu postulación ${fmtId(app)}`)
    .setDescription(
      `Has respondido todas las preguntas. Revisa tus respuestas y pulsa **Enviar postulación** cuando estés listo.\n` +
      `Si quieres cambiar algo, puedes **Reiniciar respuestas** y volver a empezar.`,
    );
}

function embedLength(e) {
  const d = e.data || e;
  let n = (d.title || '').length + (d.description || '').length + (d.footer?.text || '').length + (d.author?.name || '').length;
  for (const f of d.fields || []) n += f.name.length + f.value.length;
  return n;
}

// Agrupa embeds respetando los límites de Discord (10 embeds y 6000 caracteres por mensaje).
function groupEmbeds(embeds, maxChars = 5500) {
  const groups = [];
  let cur = [];
  let len = 0;
  for (const e of embeds) {
    const l = embedLength(e);
    if (cur.length && (cur.length >= 10 || len + l > maxChars)) { groups.push(cur); cur = []; len = 0; }
    cur.push(e);
    len += l;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// ───────── Expediente ─────────
function dossierColor(status) {
  if (status === 'aceptada') return COLORS.success;
  if (status === 'rechazada') return COLORS.danger;
  if (status === 'cerrada') return COLORS.neutral;
  return COLORS.primary;
}

function dossierEmbed(app, { requirements = [], notes = [], history = [], includePrivate = true } = {}) {
  const e = base(dossierColor(app.status))
    .setTitle(`Expediente ${fmtId(app)} • ${statusLabel(app.status)}`)
    .addFields(
      { name: 'Postulante', value: `<@${app.user_id}>\n\`${app.user_id}\``, inline: true },
      { name: 'Minecraft', value: clip(app.mc_username || '—', 64), inline: true },
      { name: 'Discord', value: clip(app.discord_username || '—', 64), inline: true },
      { name: 'Estado', value: statusLabel(app.status), inline: true },
      { name: 'Creada', value: ts(app.created_at), inline: true },
      { name: 'Enviada', value: ts(app.submitted_at), inline: true },
      { name: 'Ticket', value: app.channel_id ? `<#${app.channel_id}>` : 'Eliminado', inline: true },
    );
  if (app.resolved_at) {
    e.addFields({
      name: 'Decisión',
      value: clip(`Por <@${app.resolved_by}> • ${ts(app.resolved_at)}\nMotivo: ${app.resolution_reason || 'No indicado'}`, 1000),
    });
  }
  e.addFields({
    name: 'Requisitos configurados',
    value: requirements.length ? clip(requirements.map((r) => `• ${r.text}`).join('\n'), 1000) : 'Sin requisitos configurados.',
  });
  if (includePrivate) {
    e.addFields(
      {
        name: 'Observaciones internas',
        value: notes.length
          ? clip(notes.slice(-5).map((n) => `• <@${n.author_id}> (${ts(n.created_at, 'R')}): ${clip(n.text, 160)}`).join('\n'), 1000)
          : 'Sin observaciones.',
      },
      {
        name: 'Historial de estados',
        value: history.length
          ? clip(history.slice(-8).map((h) => `${STATUS_META[h.to_status]?.emoji ?? '•'} ${STATUS_META[h.to_status]?.label ?? h.to_status} — <@${h.actor_id}> ${ts(h.created_at, 'R')}`).join('\n'), 1000)
          : '—',
      },
    );
  }
  return e;
}

// ───────── Decisiones ─────────
function acceptEmbed(config, app, reason) {
  const e = base(COLORS.success).setTitle(`✅ Postulación ${fmtId(app)} aceptada`).setDescription(`${textOf(config, 'accept_message')}\n${SEP}`);
  if (reason) e.addFields({ name: 'Mensaje del equipo', value: clip(reason, 1000) });
  return e;
}

function rejectEmbed(config, app, reason) {
  const e = base(COLORS.danger).setTitle(`⛔ Postulación ${fmtId(app)} rechazada`).setDescription(`${textOf(config, 'reject_message')}\n${SEP}`);
  if (reason) e.addFields({ name: 'Motivo', value: clip(reason, 1000) });
  return e;
}

function infoRequestEmbed(app, message) {
  return base(COLORS.warning)
    .setTitle(`❓ Información adicional solicitada — ${fmtId(app)}`)
    .setDescription(`${SEP}\n${clip(message, 1500)}\n${SEP}`)
    .addFields({ name: 'Cómo responder', value: 'Escribe tu respuesta en este canal y, cuando termines, pulsa **Ya respondí**.' });
}

function closeEmbed(app, reason, deleteAt) {
  const e = base(COLORS.neutral)
    .setTitle(`🔒 Ticket cerrado — ${fmtId(app)}`)
    .setDescription('Este ticket ha sido cerrado y ya no admite cambios.');
  if (reason) e.addFields({ name: 'Motivo', value: clip(reason, 500) });
  if (deleteAt) e.addFields({ name: 'Eliminación', value: `El canal se eliminará ${ts(deleteAt, 'R')}.` });
  return e;
}

function reopenEmbed(app, actorId) {
  return base(COLORS.primary)
    .setTitle(`🔓 Postulación ${fmtId(app)} reabierta`)
    .setDescription(`El expediente ha vuelto a revisión (acción de <@${actorId}>).`);
}

// ───────── Administración ─────────
function statsEmbed(s, guildName) {
  const b = s.byStatus;
  const pending = (b.enviada || 0) + (b.revision || 0) + (b.info_solicitada || 0);
  const reviewers = s.reviewers.length
    ? s.reviewers.map((r, i) => `**${i + 1}.** <@${r.actor_id}> — ${r.actions} acciones (${r.decisions} decisiones)`).join('\n')
    : 'Sin actividad registrada.';
  return base(COLORS.primary)
    .setTitle(`📊 Estadísticas — ${clip(guildName, 60)}`)
    .addFields(
      { name: 'Total', value: String(s.total), inline: true },
      { name: 'Pendientes', value: String(pending), inline: true },
      { name: 'En revisión', value: String(b.revision || 0), inline: true },
      { name: 'Aceptadas', value: String(b.aceptada || 0), inline: true },
      { name: 'Rechazadas', value: String(b.rechazada || 0), inline: true },
      { name: 'Cerradas', value: String(b.cerrada || 0), inline: true },
      {
        name: 'Tiempo promedio de resolución',
        value: s.avgResolutionMs == null ? 'Aún no hay datos suficientes.' : `${formatDuration(s.avgResolutionMs)} (sobre ${s.resolvedCount} resueltas)`,
      },
      { name: 'Postulaciones por periodo', value: `Últimas 24 h: **${s.last24h}**\nÚltimos 7 días: **${s.last7d}**\nÚltimos 30 días: **${s.last30d}**` },
      { name: 'Actividad del equipo revisor', value: clip(reviewers, 1000) },
    );
}

function queueEmbed(apps, { total, page, pages, label }) {
  const lines = apps.map((a) =>
    `**${fmtId(a)}** • ${statusLabel(a.status)} • <@${a.user_id}> • MC: ${clip(a.mc_username || '—', 20)} • ${ts(a.submitted_at || a.created_at, 'R')}`);
  return base(COLORS.primary)
    .setTitle(`🗂️ Postulaciones — ${label}`)
    .setDescription(lines.length ? lines.join('\n') : 'No hay postulaciones en esta lista.')
    .setFooter({ text: `${BRAND.name} • Página ${page + 1}/${Math.max(pages, 1)} • ${total} en total` });
}

function configEmbed(config, extra) {
  const roles = (list) => (list.length ? list.map((r) => `<@&${r}>`).join(' ') : '*Ninguno*');
  const ch = (id) => (id ? `<#${id}>` : '*Sin configurar*');
  const custom = Object.keys(config.texts || {}).filter((k) => config.texts[k]);
  return base(COLORS.primary)
    .setTitle('⚙️ Configuración del servidor')
    .addFields(
      { name: 'Categoría de tickets', value: ch(config.category_id), inline: true },
      { name: 'Canal de registros', value: ch(config.log_channel_id), inline: true },
      { name: 'Canal de revisión', value: config.review_channel_id ? ch(config.review_channel_id) : '*Se usa el propio ticket*', inline: true },
      { name: 'Roles revisores', value: roles(config.reviewer_roles) },
      { name: 'Roles administrativos', value: roles(config.admin_roles) },
      { name: 'Panel', value: config.panel_channel_id ? `<#${config.panel_channel_id}>` : '*No publicado*', inline: true },
      { name: 'Cierre', value: config.close_delete_seconds > 0 ? `Eliminar canal a los ${config.close_delete_seconds} s` : 'Conservar canal bloqueado', inline: true },
      {
        name: 'Notificaciones',
        value: `Mensajes directos: ${config.dm_notifications ? 'sí' : 'no'}\nMencionar revisores: ${config.ping_reviewers ? 'sí' : 'no'}`,
        inline: true,
      },
      { name: 'Contenido', value: `${extra.questions} preguntas • ${extra.requirements} requisitos` },
      { name: 'Textos personalizados', value: custom.length ? custom.map((k) => TEXT_KEYS[k] || k).join(', ') : 'Ninguno (se usan los predeterminados)' },
    );
}

function questionsListEmbed(questions) {
  const lines = questions.map((q) =>
    `**${q.position}.** ${q.required ? '🔸' : '▫️'} **${clip(q.label, 45)}** — ${clip(q.text, 90)} \`(${q.max_length})\``);
  return base(COLORS.primary)
    .setTitle('📝 Preguntas de la postulación')
    .setDescription(clip(lines.join('\n') || 'No hay preguntas configuradas.', 4000))
    .addFields({ name: 'Leyenda', value: '🔸 obligatoria • ▫️ opcional • `(n)` límite de caracteres' });
}

function requirementsListEmbed(requirements) {
  return base(COLORS.primary)
    .setTitle('📋 Requisitos configurados')
    .setDescription(requirements.length
      ? requirements.map((r) => `**${r.position}.** ${r.text}`).join('\n')
      : 'No hay requisitos configurados. Usa `/postulaciones requisitos agregar`.');
}

function helpEmbed(isStaff, isAdmin) {
  const e = base(COLORS.primary)
    .setTitle('❔ Ayuda — KorianMC Postulaciones')
    .setDescription(
      'Para postularte, pulsa **Iniciar postulación** en el panel del servidor. Se creará un canal privado y responderás las preguntas paso a paso.',
    );
  if (isStaff) {
    e.addFields({
      name: 'Equipo revisor',
      value:
        '`/postulaciones revisar` — cola de pendientes\n`/postulaciones ver` — consultar un expediente\n' +
        '`/postulaciones aceptar` / `rechazar` — decisión con confirmación\n`/postulaciones estado` — consultar o cambiar estado\n' +
        '`/postulaciones cerrar` / `reabrir` — gestionar el ticket\n`/postulaciones añadir` / `quitar` — acceso al ticket\n`/postulaciones estadísticas`',
    });
  }
  if (isAdmin) {
    e.addFields({
      name: 'Administración',
      value:
        '`/postulaciones panel` — publicar el panel\n`/postulaciones configurar` — canales, roles, cierre, notificaciones y textos\n' +
        '`/postulaciones requisitos` — gestionar requisitos\n`/postulaciones preguntas` — gestionar preguntas\n`/postulaciones exportar` — exportar un expediente',
    });
  }
  return e;
}

function logEmbed({ title, color = COLORS.neutral, description, fields = [] }) {
  const e = base(color).setTitle(clip(title, 250));
  if (description) e.setDescription(clip(description, 3500));
  if (fields.length) e.addFields(fields.slice(0, 20).map((f) => ({ name: clip(f.name, 250), value: clip(f.value || '—', 1000), inline: !!f.inline })));
  return e;
}

module.exports = {
  base, textOf, statusLabel, infoEmbed, successEmbed, errorEmbed, warnEmbed,
  panelEmbed, requirementsEmbed, welcomeEmbed, questionEmbed, answeredEmbed, answersEmbeds, summaryIntroEmbed,
  groupEmbeds, embedLength, dossierEmbed, acceptEmbed, rejectEmbed, infoRequestEmbed, closeEmbed, reopenEmbed,
  statsEmbed, queueEmbed, configEmbed, questionsListEmbed, requirementsListEmbed, helpEmbed, logEmbed,
};
