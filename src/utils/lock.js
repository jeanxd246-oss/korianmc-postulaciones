'use strict';

// Exclusión mutua por clave (evita dobles clics y acciones simultáneas sobre lo mismo).
const tails = new Map();

async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => gate);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

module.exports = { withLock };
