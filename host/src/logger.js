// 结构化日志：单行 JSON
function log(level, msg, extra = {}) {
  const line = JSON.stringify({ ts: Math.floor(Date.now() / 1000), level, msg, ...extra });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
};
