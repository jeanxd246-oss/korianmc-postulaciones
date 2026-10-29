'use strict';

const COLORS = Object.freeze({
  primary: 0xf5b800, // amarillo KorianMC
  success: 0x2ecc71,
  danger: 0xe74c3c,
  warning: 0xf39c12,
  neutral: 0x2b2d31,
});

const BRAND = Object.freeze({
  name: 'KorianMC Postulaciones',
  community: 'KorianMC',
});

const SEP = '━━━━━━━━━━━━━━━━━━━━━━━━';

const STATUS = Object.freeze({
  PREPARACION: 'preparacion',
  ENVIADA: 'enviada',
  REVISION: 'revision',
  INFO: 'info_solicitada',
  ACEPTADA: 'aceptada',
  RECHAZADA: 'rechazada',
  CERRADA: 'cerrada',
});

const STATUS_META = Object.freeze({
  preparacion: { label: 'En preparación', emoji: '📝' },
  enviada: { label: 'Enviada', emoji: '📨' },
  revision: { label: 'En revisión', emoji: '🔎' },
  info_solicitada: { label: 'Información solicitada', emoji: '❓' },
  aceptada: { label: 'Aceptada', emoji: '✅' },
  rechazada: { label: 'Rechazada', emoji: '⛔' },
  cerrada: { label: 'Cerrada', emoji: '🔒' },
});

// Estados en los que un usuario cuenta como "con postulación activa".
const ACTIVE_STATUSES = Object.freeze(['preparacion', 'enviada', 'revision', 'info_solicitada']);
// Estados que esperan decisión del equipo.
const PENDING_STATUSES = Object.freeze(['enviada', 'revision', 'info_solicitada']);

// Transiciones permitidas (origen -> destinos).
const TRANSITIONS = Object.freeze({
  preparacion: ['enviada', 'cerrada'],
  enviada: ['revision', 'info_solicitada', 'aceptada', 'rechazada', 'cerrada'],
  revision: ['enviada', 'info_solicitada', 'aceptada', 'rechazada', 'cerrada'],
  info_solicitada: ['enviada', 'revision', 'aceptada', 'rechazada', 'cerrada'],
  aceptada: ['revision', 'cerrada'],
  rechazada: ['revision', 'cerrada'],
  cerrada: ['revision'],
});

const LIMITS = Object.freeze({
  maxQuestions: 25,
  maxRequirements: 10,
  questionTextMax: 1000,
  questionLabelMax: 45,
  requirementMax: 200,
  answerMaxAllowed: 1500,
  answerDefaultMax: 1000,
  reasonMax: 500,
  noteMax: 1000,
  textMax: 1000,
  closeDeleteMaxSeconds: 86400,
  abandonedAfterMs: 72 * 60 * 60 * 1000,
  pageSize: 8,
});

// Textos personalizables por servidor.
const TEXT_KEYS = Object.freeze({
  panel_description: 'Descripción del panel',
  process: 'Proceso de selección',
  rules: 'Normas para postulantes',
  welcome: 'Bienvenida al ticket',
  accept_message: 'Mensaje de aceptación',
  reject_message: 'Mensaje de rechazo',
});

const DEFAULT_TEXTS = Object.freeze({
  panel_description:
    '¿Quieres formar parte del equipo oficial de KorianMC?\n\n' +
    'Buscamos personas responsables, activas, respetuosas y comprometidas con nuestra comunidad. ' +
    'Si cumples los requisitos y quieres ayudar a mejorar nuestra network, puedes iniciar tu postulación desde este panel.',
  process:
    '1. Inicias la postulación y respondes las preguntas paso a paso.\n' +
    '2. El equipo revisor estudia tu expediente (Minecraft y Discord).\n' +
    '3. Puede que te pidamos información adicional.\n' +
    '4. Recibirás la decisión por mensaje directo y en tu ticket.',
  rules:
    '• Responde con sinceridad y con tus propias palabras.\n' +
    '• Mantén un trato respetuoso en todo momento.\n' +
    '• Solo puedes tener una postulación activa a la vez.\n' +
    '• No compartas información de tu ticket con terceros.',
  welcome:
    'Gracias por tu interés en formar parte de KorianMC. Responderás una serie de preguntas, una a la vez. ' +
    'Pulsa **Responder** en cada pregunta. Tus respuestas se guardan automáticamente y solo las verá el equipo autorizado.',
  accept_message:
    '¡Enhorabuena! Tu postulación ha sido aceptada. Un miembro del equipo se pondrá en contacto contigo para los siguientes pasos.',
  reject_message:
    'Gracias por tu interés y por el tiempo dedicado. En esta ocasión tu postulación no ha sido aceptada. Podrás volver a intentarlo cuando el equipo lo permita.',
});

// Preguntas por defecto (la administración puede editarlas, borrarlas o reordenarlas).
const DEFAULT_QUESTIONS = Object.freeze([
  { key: 'minecraft', label: 'Usuario de Minecraft', text: '¿Cuál es tu usuario de Minecraft? Indica si juegas en Java o Bedrock.', required: 1, max_length: 32 },
  { key: 'discord', label: 'Usuario de Discord', text: '¿Cuál es tu usuario de Discord?', required: 1, max_length: 40 },
  { key: 'edad', label: 'Edad', text: '¿Qué edad tienes? (solo el número)', required: 1, max_length: 3 },
  { key: 'pais', label: 'País y zona horaria', text: '¿De qué país eres y cuál es tu zona horaria?', required: 1, max_length: 100 },
  { key: 'horas', label: 'Horas diarias', text: '¿Cuántas horas puedes dedicar diariamente al equipo?', required: 1, max_length: 100 },
  { key: null, label: 'Experiencia en staff', text: '¿Tienes experiencia como miembro del staff? Cuéntanos dónde y durante cuánto tiempo.', required: 1, max_length: 1000 },
  { key: null, label: 'Experiencia en Minecraft', text: '¿Qué experiencia tienes administrando servidores de Minecraft?', required: 1, max_length: 1000 },
  { key: null, label: 'Experiencia en Discord', text: '¿Qué experiencia tienes moderando comunidades de Discord?', required: 1, max_length: 1000 },
  { key: null, label: 'Conocimientos', text: '¿Qué conocimientos tienes de Minecraft y de Discord?', required: 1, max_length: 1000 },
  { key: null, label: 'Motivación', text: '¿Por qué quieres formar parte del equipo de KorianMC?', required: 1, max_length: 1000 },
  { key: null, label: 'Aportación', text: '¿Qué aportarías a nuestra network?', required: 1, max_length: 1000 },
  { key: null, label: 'Usuario que incumple reglas', text: '¿Cómo actuarías ante un usuario que incumple las reglas?', required: 1, max_length: 1000 },
  { key: null, label: 'Conflicto entre miembros', text: '¿Cómo resolverías un conflicto entre miembros de la comunidad?', required: 1, max_length: 1000 },
  { key: null, label: 'Abuso de permisos', text: '¿Qué harías si otro miembro del staff abusa de sus permisos?', required: 1, max_length: 1000 },
  { key: null, label: 'Conflictos de horario', text: '¿Tienes algún conflicto de horarios o de disponibilidad que debamos conocer?', required: 0, max_length: 500 },
]);

module.exports = {
  COLORS, BRAND, SEP, STATUS, STATUS_META, ACTIVE_STATUSES, PENDING_STATUSES,
  TRANSITIONS, LIMITS, TEXT_KEYS, DEFAULT_TEXTS, DEFAULT_QUESTIONS,
};
