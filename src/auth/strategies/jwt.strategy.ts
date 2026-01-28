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
    // Validar que la sesión esté activa si existe sessionId
    if (payload.sessionId) {
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
    }

    // Retornar toda la información del payload para que esté disponible en los controllers
    return {
      ...payload,
      // Mapear sub a id para compatibilidad
      id: payload.sub,
      // Mantener también userId por si se usa en otro lugar
      userId: payload.sub,
      // Mapear tenantId a empresaId para compatibilidad con controllers
      empresaId: payload.tenantId,
      // Mapear tenantRoles a roles para compatibilidad con RolesGuard
      roles: payload.tenantRoles || [],
    };
  }
}