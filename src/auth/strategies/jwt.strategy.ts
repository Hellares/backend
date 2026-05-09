import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { AuthSessionService } from '../auth.session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private sessionService: AuthSessionService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    // Rechazar tokens sin sessionId. Todos los tokens emitidos por
    // generateTokens lo incluyen — un payload sin sessionId solo puede
    // ser un token muy viejo o forjado. Antes había un fallback que
    // saltaba la validación de sesión y blacklist; eliminado.
    if (!payload.sessionId) {
      throw new UnauthorizedException(
        'Token inválido. Por favor, inicia sesión nuevamente.',
      );
    }

    // Verificar que el usuario siga activo. Cierra la ventana donde un
    // admin desactiva un usuario pero su access token sigue vivo hasta
    // expirar. Cache de 30s evita SELECT por request.
    const isUserActive = await this.sessionService.isUserActive(payload.sub);
    if (!isUserActive) {
      throw new UnauthorizedException('Cuenta desactivada. Contacta al administrador.');
    }

    // Verificar si la sesión está en blacklist
    const isBlacklisted = await this.sessionService.isSessionBlacklisted(payload.sessionId);
    if (isBlacklisted) {
      throw new UnauthorizedException('Sesión revocada. Por favor, inicia sesión nuevamente.');
    }

    // Verificar que la sesión exista y esté activa
    const session = await this.sessionService.getSession(payload.sessionId);
    if (!session || !session.isActive) {
      throw new UnauthorizedException('Sesión inválida o expirada. Por favor, inicia sesión nuevamente.');
    }

    // Usar datos de tenant de la sesión Redis (se actualizan en switch-tenant)
    return {
      ...payload,
      id: payload.sub,
      userId: payload.sub,
      rolGlobal: payload.rolGlobal,
      empresaId: session.tenantId || payload.tenantId,
      tenantId: session.tenantId || payload.tenantId,
      tenantRole: session.tenantRole || payload.tenantRole,
      tenantName: session.tenantName || payload.tenantName,
      tenantRoles: session.tenantRoles || payload.tenantRoles,
      roles: session.tenantRoles || payload.tenantRoles || [],
    };
  }
}