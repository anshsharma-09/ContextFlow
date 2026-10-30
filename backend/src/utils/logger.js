const fs = require('fs');
const path = require('path');
const pino = require('pino');

const logDirectory = path.resolve(__dirname, '../../logs');
fs.mkdirSync(logDirectory, { recursive: true });

const destination = pino.destination({
  dest: path.join(logDirectory, 'app.log'),
  sync: true
});

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-goog-api-key',
      'apiKey',
      'password',
      'GEMINI_API_KEY'
    ],
    censor: '[REDACTED]'
  }
}, destination);

module.exports = logger;
