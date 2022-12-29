import { pino, type LoggerOptions } from 'pino';

export function loggerOptions(level: string, pretty: boolean): LoggerOptions {
  return {
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers["stripe-signature"]'],
      censor: '[redacted]',
    },
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    }),
  };
}

export function createLogger(level: string, pretty: boolean) {
  return pino(loggerOptions(level, pretty));
}
