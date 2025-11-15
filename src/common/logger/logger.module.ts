import { Module, Global } from '@nestjs/common';
import { AppLoggerService } from './logger.service';
import { AuditLoggerService } from './audit-logger.service';

/**
 * Módulo global de logging
 * Exporta servicios de logging para uso en toda la aplicación
 */
@Global()
@Module({
  providers: [AppLoggerService, AuditLoggerService],
  exports: [AppLoggerService, AuditLoggerService],
})
export class LoggerModule {}
