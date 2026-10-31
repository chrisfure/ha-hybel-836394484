const LEVELS = { debug: 10, info: 20, warning: 30, error: 40 };
let current = LEVELS.info;

export function setLevel(name) {
  current = LEVELS[name] ?? LEVELS.info;
}

function out(level, args) {
  if (LEVELS[level] < current) return;
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${level.toUpperCase().padEnd(7)} ${args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  (level === 'error' || level === 'warning' ? console.error : console.log)(line);
}

export const log = {
  debug: (...a) => out('debug', a),
  info: (...a) => out('info', a),
  warn: (...a) => out('warning', a),
  error: (...a) => out('error', a)
};
