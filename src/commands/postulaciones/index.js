'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const db = require('../../database');
const { TEXT_KEYS, LIMITS } = require('../../config/constants');
const { getAccess } = require('../../utils/permissions');
const { say, deny, sayError } = require('../../utils/respond');
const admin = require('./admin');
const content = require('./content');
const staff = require('./staff');

const id = (o, required = true) => o.setName('id').setDescription('ID del expediente (ej. 12 para #0012)').setMinValue(1).setRequired(required);
const num = (o, desc) => o.setName('numero').setDescription(desc).setMinValue(1).setRequired(true);
const textChannel = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const data = new SlashCommandBuilder()
  .setName('postulaciones')
  .setDescription('Sistema de postulaciones de KorianMC')
  .addSubcommand((s) => s.setName('panel').setDescription('Publica el panel de postulaciones')
    .addChannelOption((o) => o.setName('canal').setDescription('Canal donde publicarlo (por defecto, este)').addChannelTypes(...textChannel)))
  .addSubcommandGroup((g) => g.setName('configurar').setDescription('Configuración del servidor')
    .addSubcommand((s) => s.setName('ver').setDescription('Muestra la configuración actual'))
    .addSubcommand((s) => s.setName('categoria').setDescription('Categoría donde se crean los tickets')
      .addChannelOption((o) => o.setName('categoria').setDescription('Categoría').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand((s) => s.setName('logs').setDescription('Canal de registros')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal').addChannelTypes(...textChannel).setRequired(true)))
    .addSubcommand((s) => s.setName('revision').setDescription('Canal privado del equipo para los expedientes (vacío = quitar)')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal').addChannelTypes(...textChannel)))
    .addSubcommand((s) => s.setName('revisores').setDescription('Añade o quita roles revisores')
      .addStringOption((o) => o.setName('accion').setDescription('Acción').setRequired(true).addChoices({ name: 'Añadir', value: 'añadir' }, { name: 'Quitar', value: 'quitar' }))
      .addRoleOption((o) => o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand((s) => s.setName('administradores').setDescription('Añade o quita roles administrativos')
      .addStringOption((o) => o.setName('accion').setDescription('Acción').setRequired(true).addChoices({ name: 'Añadir', value: 'añadir' }, { name: 'Quitar', value: 'quitar' }))
      .addRoleOption((o) => o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand((s) => s.setName('cierre').setDescription('Qué ocurre al cerrar un ticket')
      .addIntegerOption((o) => o.setName('segundos').setDescription('Segundos hasta eliminar el canal (0 = conservarlo bloqueado)').setMinValue(0).setMaxValue(LIMITS.closeDeleteMaxSeconds).setRequired(true)))
    .addSubcommand((s) => s.setName('notificaciones').setDescription('Ajustes de notificaciones')
      .addBooleanOption((o) => o.setName('mensajes_directos').setDescription('Avisar al postulante por MD'))
      .addBooleanOption((o) => o.setName('mencionar_revisores').setDescription('Mencionar a los revisores en nuevas postulaciones')))
    .addSubcommand((s) => s.setName('textos').setDescription('Edita los textos del sistema')
      .addStringOption((o) => o.setName('tipo').setDescription('Texto a editar').setRequired(true)
        .addChoices(...Object.entries(TEXT_KEYS).map(([value, name]) => ({ name, value }))))))
  .addSubcommandGroup((g) => g.setName('requisitos').setDescription('Requisitos de la postulación')
    .addSubcommand((s) => s.setName('listar').setDescription('Lista los requisitos'))
    .addSubcommand((s) => s.setName('agregar').setDescription('Añade un requisito')
      .addStringOption((o) => o.setName('texto').setDescription('Texto del requisito').setMaxLength(LIMITS.requirementMax).setRequired(true)))
    .addSubcommand((s) => s.setName('editar').setDescription('Edita un requisito')
      .addIntegerOption((o) => num(o, 'Número del requisito'))
      .addStringOption((o) => o.setName('texto').setDescription('Nuevo texto').setMaxLength(LIMITS.requirementMax).setRequired(true)))
    .addSubcommand((s) => s.setName('eliminar').setDescription('Elimina un requisito')
      .addIntegerOption((o) => num(o, 'Número del requisito'))))
  .addSubcommandGroup((g) => g.setName('preguntas').setDescription('Preguntas de la postulación')
    .addSubcommand((s) => s.setName('listar').setDescription('Lista las preguntas'))
    .addSubcommand((s) => s.setName('agregar').setDescription('Añade una pregunta')
      .addStringOption((o) => o.setName('etiqueta').setDescription('Título corto').setMaxLength(LIMITS.questionLabelMax).setRequired(true))
      .addStringOption((o) => o.setName('texto').setDescription('Texto de la pregunta').setMaxLength(LIMITS.questionTextMax).setRequired(true))
      .addBooleanOption((o) => o.setName('obligatoria').setDescription('¿Es obligatoria? (por defecto sí)'))
      .addIntegerOption((o) => o.setName('largo').setDescription('Máximo de caracteres de la respuesta').setMinValue(1).setMaxValue(LIMITS.answerMaxAllowed)))
    .addSubcommand((s) => s.setName('editar').setDescription('Edita una pregunta')
      .addIntegerOption((o) => num(o, 'Número de la pregunta'))
      .addStringOption((o) => o.setName('etiqueta').setDescription('Nuevo título').setMaxLength(LIMITS.questionLabelMax))
      .addStringOption((o) => o.setName('texto').setDescription('Nuevo texto').setMaxLength(LIMITS.questionTextMax))
      .addBooleanOption((o) => o.setName('obligatoria').setDescription('¿Obligatoria?'))
      .addIntegerOption((o) => o.setName('largo').setDescription('Máximo de caracteres').setMinValue(1).setMaxValue(LIMITS.answerMaxAllowed)))
    .addSubcommand((s) => s.setName('eliminar').setDescription('Elimina una pregunta')
      .addIntegerOption((o) => num(o, 'Número de la pregunta')))
    .addSubcommand((s) => s.setName('mover').setDescription('Cambia el orden de una pregunta')
      .addIntegerOption((o) => num(o, 'Número actual'))
      .addIntegerOption((o) => o.setName('posicion').setDescription('Nueva posición').setMinValue(1).setRequired(true)))
    .addSubcommand((s) => s.setName('restablecer').setDescription('Restablece las preguntas predeterminadas')
      .addBooleanOption((o) => o.setName('confirmar').setDescription('Confirma que quieres reemplazar las actuales').setRequired(true))))
  .addSubcommand((s) => s.setName('revisar').setDescription('Muestra las postulaciones')
    .addStringOption((o) => o.setName('estado').setDescription('Filtro (por defecto, pendientes)').addChoices(
      { name: 'Pendientes', value: 'pendientes' }, { name: 'Enviadas', value: 'enviada' }, { name: 'En revisión', value: 'revision' },
      { name: 'Información solicitada', value: 'info_solicitada' }, { name: 'Aceptadas', value: 'aceptada' },
      { name: 'Rechazadas', value: 'rechazada' }, { name: 'Cerradas', value: 'cerrada' }))
    .addIntegerOption((o) => o.setName('pagina').setDescription('Página').setMinValue(1)))
  .addSubcommand((s) => s.setName('ver').setDescription('Consulta un expediente').addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('aceptar').setDescription('Acepta una postulación (con confirmación)').addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('rechazar').setDescription('Rechaza una postulación (con confirmación)').addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('estado').setDescription('Consulta o actualiza el estado de un expediente')
    .addIntegerOption((o) => id(o, false))
    .addStringOption((o) => o.setName('nuevo').setDescription('Nuevo estado').addChoices(
      { name: 'Enviada (pendiente)', value: 'enviada' }, { name: 'En revisión', value: 'revision' }, { name: 'Información solicitada', value: 'info_solicitada' })))
  .addSubcommand((s) => s.setName('cerrar').setDescription('Cierra un ticket').addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('reabrir').setDescription('Reabre un expediente').addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('añadir').setDescription('Da acceso a un miembro del equipo a un ticket')
    .addUserOption((o) => o.setName('miembro').setDescription('Miembro').setRequired(true)).addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('quitar').setDescription('Retira el acceso de un miembro a un ticket')
    .addUserOption((o) => o.setName('miembro').setDescription('Miembro').setRequired(true)).addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('estadísticas').setDescription('Estadísticas del sistema'))
  .addSubcommand((s) => s.setName('exportar').setDescription('Exporta un expediente a un archivo de texto').addIntegerOption((o) => id(o, false)))
  .addSubcommand((s) => s.setName('ayuda').setDescription('Instrucciones del sistema'));

// ruta → { level, run }
const routes = {
  'panel': { level: 'admin', run: admin.publishPanel },
  'configurar/ver': { level: 'admin', run: admin.viewConfig },
  'configurar/categoria': { level: 'admin', run: admin.setCategory },
  'configurar/logs': { level: 'admin', run: admin.setLogs },
  'configurar/revision': { level: 'admin', run: admin.setReview },
  'configurar/revisores': { level: 'admin', run: (i) => admin.setRole(i, 'reviewer_roles', 'Roles revisores') },
  'configurar/administradores': { level: 'admin', run: (i) => admin.setRole(i, 'admin_roles', 'Roles administrativos') },
  'configurar/cierre': { level: 'admin', run: admin.setClose },
  'configurar/notificaciones': { level: 'admin', run: admin.setNotifications },
  'configurar/textos': { level: 'admin', run: admin.editText },
  'requisitos/listar': { level: 'admin', run: content.reqList },
  'requisitos/agregar': { level: 'admin', run: content.reqAdd },
  'requisitos/editar': { level: 'admin', run: content.reqEdit },
  'requisitos/eliminar': { level: 'admin', run: content.reqDelete },
  'preguntas/listar': { level: 'admin', run: content.qList },
  'preguntas/agregar': { level: 'admin', run: content.qAdd },
  'preguntas/editar': { level: 'admin', run: content.qEdit },
  'preguntas/eliminar': { level: 'admin', run: content.qDelete },
  'preguntas/mover': { level: 'admin', run: content.qMove },
  'preguntas/restablecer': { level: 'admin', run: content.qReset },
  'revisar': { level: 'reviewer', run: staff.queue },
  'ver': { level: 'reviewer', run: staff.view },
  'aceptar': { level: 'reviewer', run: (i) => staff.confirmDecision(i, 'a') },
  'rechazar': { level: 'reviewer', run: (i) => staff.confirmDecision(i, 'r') },
  'estado': { level: 'reviewer', run: staff.state },
  'cerrar': { level: 'reviewer', run: staff.closeCmd },
  'reabrir': { level: 'reviewer', run: staff.reopenCmd },
  'añadir': { level: 'reviewer', run: (i) => staff.ticketAccess(i, true) },
  'quitar': { level: 'reviewer', run: (i) => staff.ticketAccess(i, false) },
  'estadísticas': { level: 'reviewer', run: staff.stats },
  'exportar': { level: 'admin', run: staff.exportCmd },
  'ayuda': { level: 'public', run: staff.help },
};

async function execute(interaction) {
  if (!interaction.inGuild() || !interaction.guild) {
    return say(interaction, { content: 'Este comando solo puede usarse dentro de un servidor.' });
  }
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const route = routes[group ? `${group}/${sub}` : sub];
  if (!route) return sayError(interaction, 'Comando no reconocido', 'Ejecuta de nuevo el registro de comandos.');
  const config = db.repo.ensureGuild(interaction.guildId);
  const access = getAccess(interaction, config);
  if ((route.level === 'admin' && !access.admin) || (route.level === 'reviewer' && !access.reviewer)) return deny(interaction);
  return route.run(interaction, { config, access });
}

module.exports = { data, execute, routes };
