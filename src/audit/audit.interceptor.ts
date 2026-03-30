import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { AccionAudit } from '@prisma/client';

/**
 * Interceptor que registra automáticamente acciones en rutas admin.
 * Se aplica a nivel de controller o método con @UseInterceptors(AuditInterceptor).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // Solo auditar mutaciones
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const path = request.route?.path || request.url;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          const duration = Date.now() - startTime;
          const { accion, entidad, detalle } = this.resolveAction(method, path, request.body, responseData);

          if (accion) {
            this.auditService.logFromRequest(request, accion, entidad, detalle, {
              entidadId: request.params?.id,
              metadata: {
                method,
                path,
                duration,
                body: this.sanitizeBody(request.body),
              },
            });
          }
        },
        error: (error) => {
          const { accion, entidad } = this.resolveAction(method, path, request.body);

          if (accion) {
            this.auditService.logFromRequest(request, accion, entidad, `Error: ${error?.message}`, {
              entidadId: request.params?.id,
              metadata: {
                method,
                path,
                error: error?.message,
                statusCode: error?.status,
              },
            });
          }
        },
      }),
    );
  }

  private resolveAction(method: string, path: string, body?: any, response?: any): {
    accion: AccionAudit | null;
    entidad: string;
    detalle: string;
  } {
    // Admin empresas
    if (path.includes('/admin/empresas') && path.includes('/plan')) {
      return { accion: AccionAudit.PLAN_CAMBIADO, entidad: 'Empresa', detalle: `Plan cambiado${body?.planId ? ' a ' + body.planId : ''}` };
    }
    if (path.includes('/admin/empresas') && path.includes('/suscripcion')) {
      return { accion: AccionAudit.SUSCRIPCION_EXTENDIDA, entidad: 'Empresa', detalle: 'Suscripción actualizada' };
    }
    if (path.includes('/admin/empresas') && method === 'PATCH') {
      const estado = body?.estadoSuscripcion;
      if (estado === 'SUSPENDIDA') return { accion: AccionAudit.EMPRESA_SUSPENDIDA, entidad: 'Empresa', detalle: `Empresa suspendida${body?.motivo ? ': ' + body.motivo : ''}` };
      if (estado === 'ACTIVA') return { accion: AccionAudit.EMPRESA_ACTIVADA, entidad: 'Empresa', detalle: 'Empresa activada' };
      return { accion: AccionAudit.EMPRESA_ACTUALIZADA, entidad: 'Empresa', detalle: 'Empresa actualizada' };
    }

    // Admin usuarios
    if (path.includes('/admin/usuarios') && method === 'PATCH') {
      if (body?.isActive === false) return { accion: AccionAudit.USUARIO_BLOQUEADO, entidad: 'Usuario', detalle: `Usuario bloqueado${body?.motivo ? ': ' + body.motivo : ''}` };
      if (body?.isActive === true) return { accion: AccionAudit.USUARIO_DESBLOQUEADO, entidad: 'Usuario', detalle: 'Usuario desbloqueado' };
    }

    // Admin pagos
    if (path.includes('/pagos') && path.includes('/validar')) {
      return { accion: AccionAudit.PAGO_VALIDADO, entidad: 'Pago', detalle: 'Pago validado' };
    }
    if (path.includes('/pagos') && path.includes('/rechazar')) {
      return { accion: AccionAudit.PAGO_RECHAZADO, entidad: 'Pago', detalle: `Pago rechazado${body?.motivo ? ': ' + body.motivo : ''}` };
    }
    if (path.includes('/pagos') && path.includes('/anular')) {
      return { accion: AccionAudit.PAGO_ANULADO, entidad: 'Pago', detalle: 'Pago anulado' };
    }
    if (path.includes('/admin/pagos') && method === 'POST') {
      return { accion: AccionAudit.ADMIN_ACCION, entidad: 'Pago', detalle: 'Pago registrado por admin' };
    }

    // Pagos suscripcion (cliente)
    if (path.includes('/pagos-suscripcion/solicitar')) {
      return { accion: AccionAudit.PAGO_SOLICITADO, entidad: 'Pago', detalle: 'Solicitud de pago creada' };
    }
    if (path.includes('/pagos-suscripcion') && path.includes('/comprobante')) {
      return { accion: AccionAudit.PAGO_COMPROBANTE_SUBIDO, entidad: 'Pago', detalle: 'Comprobante de pago subido' };
    }

    // Notificaciones admin
    if (path.includes('/notificaciones/broadcast')) {
      return { accion: AccionAudit.BROADCAST_ENVIADO, entidad: 'Notificacion', detalle: `Broadcast: ${body?.titulo || ''}` };
    }
    if (path.includes('/notificaciones/empresa')) {
      return { accion: AccionAudit.NOTIFICACION_ENVIADA, entidad: 'Notificacion', detalle: `Notificación a empresa: ${body?.titulo || ''}` };
    }
    if (path.includes('/notificaciones/usuarios')) {
      return { accion: AccionAudit.NOTIFICACION_ENVIADA, entidad: 'Notificacion', detalle: `Notificación a ${body?.usuarioIds?.length || 0} usuarios` };
    }

    // Config
    if (path.includes('/configuracion-sistema') && method === 'PATCH') {
      return { accion: AccionAudit.CONFIG_ACTUALIZADA, entidad: 'ConfigSistema', detalle: `Configuración actualizada: ${Object.keys(body || {}).join(', ')}` };
    }

    // Auth
    if (path.includes('/auth/login') && method === 'POST') {
      return { accion: AccionAudit.LOGIN, entidad: 'Auth', detalle: `Login: ${body?.credencial || ''}` };
    }
    if (path.includes('/auth/logout')) {
      return { accion: AccionAudit.LOGOUT, entidad: 'Auth', detalle: 'Logout' };
    }

    // Admin planes
    if (path.includes('/admin/planes') && method === 'PATCH') {
      return { accion: AccionAudit.ADMIN_ACCION, entidad: 'Plan', detalle: 'Plan actualizado' };
    }

    return { accion: null, entidad: '', detalle: '' };
  }

  private sanitizeBody(body: any): any {
    if (!body) return {};
    const sanitized = { ...body };
    // Remove sensitive fields
    delete sanitized.password;
    delete sanitized.passwordHash;
    delete sanitized.token;
    delete sanitized.refreshToken;
    delete sanitized.accessToken;
    return sanitized;
  }
}
