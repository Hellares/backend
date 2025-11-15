import { Injectable } from '@nestjs/common';
import { AppLoggerService } from './logger.service';

/**
 * Acciones auditables del sistema
 */
export enum AuditAction {
  // Autenticación
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',

  // Gestión de usuarios
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_ACTIVATED = 'USER_ACTIVATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',

  // Gestión de empresas/tenants
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_UPDATED = 'TENANT_UPDATED',
  TENANT_DELETED = 'TENANT_DELETED',
  TENANT_USER_ADDED = 'TENANT_USER_ADDED',
  TENANT_USER_REMOVED = 'TENANT_USER_REMOVED',

  // Seguridad
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  UNAUTHORIZED_ACCESS_ATTEMPT = 'UNAUTHORIZED_ACCESS_ATTEMPT',

  // Datos sensibles
  SENSITIVE_DATA_ACCESSED = 'SENSITIVE_DATA_ACCESSED',
  SENSITIVE_DATA_MODIFIED = 'SENSITIVE_DATA_MODIFIED',
  SENSITIVE_DATA_DELETED = 'SENSITIVE_DATA_DELETED',

  // Configuración
  SETTINGS_CHANGED = 'SETTINGS_CHANGED',
  PERMISSION_CHANGED = 'PERMISSION_CHANGED',
}

export interface AuditLogEntry {
  action: AuditAction;
  actor?: {
    userId?: string;
    email?: string;
    role?: string;
    ip?: string;
  };
  target?: {
    type: string;
    id?: string;
    email?: string;
    name?: string;
  };
  changes?: {
    before?: any;
    after?: any;
  };
  metadata?: Record<string, any>;
  success: boolean;
  errorMessage?: string;
}

@Injectable()
export class AuditLoggerService {
  private logger: AppLoggerService;

  constructor() {
    this.logger = new AppLoggerService();
    this.logger.setContext('AuditLog');
  }

  /**
   * Registrar una acción auditable
   */
  log(entry: AuditLogEntry) {
    const { action, actor, target, changes, metadata, success, errorMessage } = entry;

    const auditMessage = `${action}${success ? ' - SUCCESS' : ' - FAILED'}`;

    const auditMetadata = {
      action,
      actor: actor
        ? {
            userId: actor.userId,
            email: actor.email,
            role: actor.role,
            ip: actor.ip,
          }
        : undefined,
      target: target
        ? {
            type: target.type,
            id: target.id,
            email: target.email,
            name: target.name,
          }
        : undefined,
      changes: changes
        ? {
            before: this.sanitizeChanges(changes.before),
            after: this.sanitizeChanges(changes.after),
          }
        : undefined,
      metadata,
      success,
      errorMessage,
      timestamp: new Date().toISOString(),
    };

    if (success) {
      this.logger.audit(auditMessage, auditMetadata);
    } else {
      this.logger.error(auditMessage, undefined, auditMetadata);
    }
  }

  /**
   * Limpiar datos sensibles de los cambios
   */
  private sanitizeChanges(data: any): any {
    if (!data) return data;
    if (typeof data !== 'object') return data;

    const sensitiveFields = ['password', 'passwordHash', 'salt', 'token', 'refreshToken', 'accessToken'];
    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  // Métodos de conveniencia para acciones comunes

  logUserRegistered(userId: string, email: string, tenantId?: string) {
    this.log({
      action: AuditAction.USER_REGISTERED,
      target: {
        type: 'User',
        id: userId,
        email,
      },
      metadata: { tenantId },
      success: true,
    });
  }

  logUserLogin(userId: string, email: string, ip: string, success: boolean, errorMessage?: string) {
    this.log({
      action: success ? AuditAction.USER_LOGIN : AuditAction.USER_LOGIN_FAILED,
      actor: {
        userId: success ? userId : undefined,
        email,
        ip,
      },
      target: {
        type: 'User',
        id: userId,
        email,
      },
      success,
      errorMessage,
    });
  }

  logPasswordChanged(actorUserId: string, actorEmail: string, targetUserId: string) {
    this.log({
      action: AuditAction.PASSWORD_CHANGED,
      actor: {
        userId: actorUserId,
        email: actorEmail,
      },
      target: {
        type: 'User',
        id: targetUserId,
      },
      success: true,
    });
  }

  logEmailVerified(userId: string, email: string) {
    this.log({
      action: AuditAction.EMAIL_VERIFIED,
      target: {
        type: 'User',
        id: userId,
        email,
      },
      success: true,
    });
  }

  logPasswordResetRequested(email: string, ip: string, success: boolean) {
    this.log({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      actor: {
        email,
        ip,
      },
      target: {
        type: 'User',
        email,
      },
      success,
    });
  }

  logAccountLocked(email: string, reason: string, ip: string) {
    this.log({
      action: AuditAction.ACCOUNT_LOCKED,
      target: {
        type: 'User',
        email,
      },
      metadata: {
        reason,
        ip,
      },
      success: true,
    });
  }

  logSessionRevoked(userId: string, sessionId: string, reason?: string) {
    this.log({
      action: AuditAction.SESSION_REVOKED,
      target: {
        type: 'Session',
        id: sessionId,
      },
      metadata: {
        userId,
        reason,
      },
      success: true,
    });
  }

  logUnauthorizedAccess(resource: string, userId?: string, ip?: string) {
    this.log({
      action: AuditAction.UNAUTHORIZED_ACCESS_ATTEMPT,
      actor: {
        userId,
        ip,
      },
      target: {
        type: 'Resource',
        name: resource,
      },
      success: false,
    });
  }

  logRoleChanged(
    actorUserId: string,
    actorEmail: string,
    targetUserId: string,
    targetEmail: string,
    oldRole: string,
    newRole: string,
  ) {
    this.log({
      action: AuditAction.USER_ROLE_CHANGED,
      actor: {
        userId: actorUserId,
        email: actorEmail,
      },
      target: {
        type: 'User',
        id: targetUserId,
        email: targetEmail,
      },
      changes: {
        before: { role: oldRole },
        after: { role: newRole },
      },
      success: true,
    });
  }
}
