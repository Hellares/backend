import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as cls from 'cls-hooked';

/**
 * Middleware para crear y mantener contexto de request
 * Usa continuation-local-storage (CLS) para propagar contexto
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const namespace = cls.getNamespace('app') || cls.createNamespace('app');

    namespace.run(() => {
      // Generar o usar requestId existente
      const requestId = (req.headers['x-request-id'] as string) || uuidv4();

      // Guardar en namespace CLS
      namespace.set('requestId', requestId);

      // Extraer información del request
      const ip = this.extractIp(req);
      const userAgent = req.headers['user-agent'] || 'Unknown';

      namespace.set('ip', ip);
      namespace.set('userAgent', userAgent);

      // Si hay usuario autenticado en el request, agregarlo al contexto
      // Esto se llenará después de la autenticación
      if ((req as any).user) {
        const user = (req as any).user;
        namespace.set('userId', user.sub || user.id);
        namespace.set('email', user.email);
        namespace.set('tenantId', user.tenantId);
      }

      // Agregar requestId a headers de respuesta
      res.setHeader('X-Request-ID', requestId);

      next();
    });
  }

  /**
   * Extraer IP real del request (considerando proxies)
   */
  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];

    if (forwarded) {
      const ips = (forwarded as string).split(',').map((ip) => ip.trim());
      return ips[0];
    }

    if (req.headers['x-real-ip']) {
      return req.headers['x-real-ip'] as string;
    }

    return req.ip || req.socket.remoteAddress || 'unknown';
  }
}

/**
 * Helper para obtener el contexto actual desde cualquier lugar
 */
export class RequestContext {
  static getRequestId(): string | undefined {
    const namespace = cls.getNamespace('app');
    return namespace?.get('requestId');
  }

  static getUserId(): string | undefined {
    const namespace = cls.getNamespace('app');
    return namespace?.get('userId');
  }

  static getEmail(): string | undefined {
    const namespace = cls.getNamespace('app');
    return namespace?.get('email');
  }

  static getTenantId(): string | undefined {
    const namespace = cls.getNamespace('app');
    return namespace?.get('tenantId');
  }

  static getIp(): string | undefined {
    const namespace = cls.getNamespace('app');
    return namespace?.get('ip');
  }

  static getUserAgent(): string | undefined {
    const namespace = cls.getNamespace('app');
    return namespace?.get('userAgent');
  }

  /**
   * Establecer información del usuario en el contexto
   * (llamar después de autenticación)
   */
  static setUser(userId: string, email: string, tenantId?: string) {
    const namespace = cls.getNamespace('app');
    if (namespace) {
      namespace.set('userId', userId);
      namespace.set('email', email);
      if (tenantId) {
        namespace.set('tenantId', tenantId);
      }
    }
  }

  /**
   * Obtener todo el contexto
   */
  static getAll(): {
    requestId?: string;
    userId?: string;
    email?: string;
    tenantId?: string;
    ip?: string;
    userAgent?: string;
  } {
    return {
      requestId: this.getRequestId(),
      userId: this.getUserId(),
      email: this.getEmail(),
      tenantId: this.getTenantId(),
      ip: this.getIp(),
      userAgent: this.getUserAgent(),
    };
  }
}
