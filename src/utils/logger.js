'use strict';

function fmt(level, args) {
  const out = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)));
  return `[${new Date().toISOString()}] [${level}] ${out.join(' ')}`;
}

module.exports = {
  info: (...a) => console.log(fmt('INFO', a)),
  warn: (...a) => console.warn(fmt('WARN', a)),
  error: (...a) => console.error(fmt('ERROR', a)),
};
