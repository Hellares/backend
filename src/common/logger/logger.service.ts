import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { logger } from './winston.config';
import { getNamespace } from 'cls-hooked';

export interface LogMetadata {
  context?: string;
  requestId?: string;
  userId?: string;
  tenantId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  duration?: number;
  [key: string]: any;
}

@Injectable()
export class AppLoggerService implements NestLoggerService {
  private context?: string;

  setContext(context: string) {
    this.context = context;
  }

  /**
   * Obtener metadata del contexto actual (CLS)
   */
  private getContextMetadata(): Partial<LogMetadata> {
    const namespace = getNamespace('app');
    if (!namespace) return {};

    return {
      requestId: namespace.get('requestId'),
      userId: namespace.get('userId'),
      tenantId: namespace.get('tenantId'),
      email: namespace.get('email'),
      ip: namespace.get('ip'),
      userAgent: namespace.get('userAgent'),
    };
  }

  /**
   * Combinar metadata del contexto con metadata adicional
   */
  private buildMetadata(metadata?: LogMetadata): LogMetadata {
    const contextMetadata = this.getContextMetadata();
    return {
      context: this.context || 'Application',
      ...contextMetadata,
      ...metadata,
    };
  }

  /**
   * Log nivel: error
   */
  error(message: string, trace?: string, metadata?: LogMetadata) {
    const meta = this.buildMetadata(metadata);
    logger.error(message, {
      ...meta,
      stack: trace,
    });
  }

  /**
   * Log nivel: warn
   */
  warn(message: string, metadata?: LogMetadata) {
    const meta = this.buildMetadata(metadata);
    logger.warn(message, meta);
  }

  /**
   * Log nivel: info (alias: log)
   */
  log(message: string, metadata?: LogMetadata) {
    this.info(message, metadata);
  }

  info(message: string, metadata?: LogMetadata) {
    const meta = this.buildMetadata(metadata);
    logger.info(message, meta);
  }

  /**
   * Log nivel: debug
   */
  debug(message: string, metadata?: LogMetadata) {
    const meta = this.buildMetadata(metadata);
    logger.debug(message, meta);
  }

  /**
   * Log nivel: http (requests HTTP)
   */
  http(message: string, metadata?: LogMetadata) {
    const meta = this.buildMetadata(metadata);
    logger.log('http', message, meta);
  }

  /**
   * Log nivel: audit (auditoría de acciones críticas)
   */
  audit(message: string, metadata?: LogMetadata) {
    const meta = this.buildMetadata(metadata);
    logger.log('audit', message, meta);
  }

  /**
   * Logs específicos para operaciones exitosas
   */
  success(message: string, metadata?: LogMetadata) {
    this.info(`✓ ${message}`, metadata);
  }

  /**
   * Logs específicos para operaciones fallidas
   */
  failure(message: string, metadata?: LogMetadata) {
    this.error(`✗ ${message}`, undefined, metadata);
  }

  /**
   * Log con performance timing
   */
  performance(operation: string, startTime: number, metadata?: LogMetadata) {
    const duration = Date.now() - startTime;
    this.info(`Performance: ${operation}`, {
      ...metadata,
      duration,
    });

    // Advertir si la operación tomó mucho tiempo
    if (duration > 1000) {
      this.warn(`Slow operation detected: ${operation}`, {
        ...metadata,
        duration,
      });
    }
  }

  /**
   * Crear un logger hijo con contexto específico
   */
  child(context: string): AppLoggerService {
    const childLogger = new AppLoggerService();
    childLogger.setContext(context);
    return childLogger;
  }
}
