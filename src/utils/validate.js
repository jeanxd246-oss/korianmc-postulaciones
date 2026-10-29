'use strict';

const { LIMITS } = require('../config/constants');

function cleanText(value, max) {
  const s = String(value ?? '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Validación opcional por clave de pregunta. Devuelve texto de error o null.
function validateAnswerByKey(key, answer) {
  if (!key) return null;
  if (key === 'edad') {
    if (!/^\d{1,2}$/.test(answer)) return 'Indica tu edad solo con números (por ejemplo, 18).';
    const n = Number(answer);
    if (n < 5 || n > 99) return 'Indica una edad válida.';
  }
  if (key === 'minecraft') {
    if (/\n/.test(answer)) return 'El usuario de Minecraft debe ir en una sola línea.';
    if (answer.length < 3) return 'El usuario de Minecraft es demasiado corto.';
  }
  return null;
}

function clampAnswerLength(n) {
  const v = Number.isInteger(n) ? n : LIMITS.answerDefaultMax;
  return Math.min(Math.max(v, 1), LIMITS.answerMaxAllowed);
}

module.exports = { cleanText, validateAnswerByKey, clampAnswerLength };
