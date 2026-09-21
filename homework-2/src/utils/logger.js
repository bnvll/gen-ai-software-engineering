'use strict';

const SILENT = process.env.LOG_LEVEL === 'silent';

function log(level, message) {
  if (SILENT) return;
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

module.exports = {
  info: (message) => log('info', message),
  warn: (message) => log('warn', message),
  error: (message) => log('error', message),
  isSilent: () => SILENT,
};
