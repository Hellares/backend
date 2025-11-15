import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';

// Workaround for CommonJS modules
const DailyRotateFileTransport = DailyRotateFile as any;
const LokiTransport = require('winston-loki');

// Niveles de log personalizados
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  audit: 4,
  debug: 5,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  audit: 'blue',
  debug: 'gray',
};

winston.addColors(colors);

// Formato para consola (desarrollo)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, context, message, requestId, userId, tenantId, metadata, ...rest } = info;

    let msg = `${timestamp} [${level}] [${context || 'Application'}]`;

    if (requestId) msg += ` [ReqID: ${String(requestId).substring(0, 8)}]`;
    if (userId) msg += ` [User: ${String(userId).substring(0, 8)}]`;
    if (tenantId) msg += ` [Tenant: ${tenantId}]`;

    msg += ` ${message}`;

    // Agregar metadata adicional si existe (filtrar campos internos de winston)
    if (metadata && typeof metadata === 'object') {
      const relevantMetadata: any = { ...metadata };
      delete relevantMetadata.timestamp;
      delete relevantMetadata.level;
      delete relevantMetadata.message;

      if (Object.keys(relevantMetadata).length > 0) {
        msg += ` ${JSON.stringify(relevantMetadata)}`;
      }
    }

    return msg;
  })
);

// Formato JSON para archivos (producción)
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.metadata(),
  winston.format.json()
);

// Filtro para remover datos sensibles
const sanitizeFormat = winston.format((info) => {
  const sensitiveFields = ['password', 'passwordHash', 'salt', 'token', 'refreshToken', 'accessToken', 'resetToken'];

  const sanitize = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sanitized: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveFields.includes(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  };

  // Sanitizar el objeto info y retornarlo
  const sanitizedInfo = sanitize(info);

  // Retornar el info transformado
  Object.keys(info).forEach(key => delete info[key]);
  Object.assign(info, sanitizedInfo);

  return info;
});

// Transporte: Consola (desarrollo)
const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
});

// Transporte: Archivo de errores con rotación
const errorFileTransport = new DailyRotateFileTransport({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  format: jsonFormat,
  maxSize: '20m',
  maxFiles: '14d', // Mantener 14 días
  zippedArchive: true,
});

// Transporte: Archivo combinado con rotación
const combinedFileTransport = new DailyRotateFileTransport({
  filename: 'logs/combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  format: jsonFormat,
  maxSize: '20m',
  maxFiles: '7d', // Mantener 7 días
  zippedArchive: true,
});

// Transporte: Archivo de auditoría
const auditFileTransport = new DailyRotateFileTransport({
  filename: 'logs/audit-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'audit',
  format: jsonFormat,
  maxSize: '20m',
  maxFiles: '30d', // Mantener 30 días (requisito de auditoría)
  zippedArchive: true,
});

// Transporte: Loki (temporalmente desactivado para depuración)
// const lokiTransport = process.env.LOKI_URL
//   ? new LokiTransport({
//       host: process.env.LOKI_URL || 'http://loki:3100',
//       labels: {
//         app: 'saas-backend',
//         environment: process.env.NODE_ENV || 'development',
//       },
//       json: true,
//       format: winston.format.json(),
//       replaceTimestamp: true,
//       onConnectionError: (err) => console.error('Loki connection error:', err),
//     })
//   : null;
const lokiTransport = null; // Temporalmente desactivado

// Configuración del logger
export const winstonConfig = {
  levels,
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
  ),
  transports: [
    consoleTransport,
    // File transports temporalmente deshabilitados (problemas de permisos en Docker)
    // errorFileTransport,
    // combinedFileTransport,
    // auditFileTransport,
    ...(lokiTransport ? [lokiTransport] : []),
  ].filter(Boolean),
  // Exception y rejection handlers temporalmente deshabilitados (problemas de permisos en Docker)
  // exceptionHandlers: [
  //   new DailyRotateFileTransport({
  //     filename: 'logs/exceptions-%DATE%.log',
  //     datePattern: 'YYYY-MM-DD',
  //     maxSize: '20m',
  //     maxFiles: '14d',
  //     zippedArchive: true,
  //   }),
  // ],
  // rejectionHandlers: [
  //   new DailyRotateFileTransport({
  //     filename: 'logs/rejections-%DATE%.log',
  //     datePattern: 'YYYY-MM-DD',
  //     maxSize: '20m',
  //     maxFiles: '14d',
  //     zippedArchive: true,
  //   }),
  // ],
};

// Exportar una instancia del logger
export const logger = winston.createLogger(winstonConfig);
