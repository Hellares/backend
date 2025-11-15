import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditLoggerService } from '../common/logger/audit-logger.service';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { AuthSessionService } from './auth.session.service';
import { AuthSecurityService } from './services/auth.security.service';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtPayload, RefreshTokenPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionService: AuthSessionService,
    private readonly securityService: AuthSecurityService,
    private readonly emailService: EmailService,
    private readonly auditLogger: AuditLoggerService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(AuthService.name);
  }

  /**
   * Registro de nuevo usuario
   */
  async register(registerDto: RegisterDto, tenantId?: string) {
    const { email, password, nombres, apellidos, telefono, dni, subdominioEmpresa } = registerDto;

    // Verificar si el email ya existe
    const existingUser = await this.prisma.usuario.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    // Determinar el tenant si no se proporciona
    let empresaId = tenantId;
    if (!empresaId && subdominioEmpresa) {
      const empresa = await this.prisma.empresa.findUnique({
        where: { subdominio: subdominioEmpresa },
      });
      if (!empresa) {
        throw new NotFoundException('Empresa no encontrada');
      }
      empresaId = empresa.id;
    }

    // Hash de la contraseña
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Crear la persona primero
    const persona = await this.prisma.persona.create({
      data: {
        nombres,
        apellidos,
        telefono,
        dni,
        esUsuario: true,
      },
    });

    // Generar token de verificación de email
    const verificationToken = uuidv4();
    const verificationTokenExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    // Crear el usuario
    const usuario = await this.prisma.usuario.create({
      data: {
        personaId: persona.id,
        email,
        passwordHash,
        salt,
        emailVerificado: false,
        telefonoVerificado: false,
        resetToken: verificationToken, // Reutilizamos resetToken para verificación
        resetTokenExpiracion: verificationTokenExpiration,
      },
      include: {
        persona: true,
      },
    });

    // Si hay una empresa, crear la relación empresa-usuario
    if (empresaId) {
      await this.prisma.empresaUsuarioRol.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          rol: 'CLIENTE', // Rol por defecto
        },
      });
    }

    // Enviar email de verificación (no bloquear el registro si falla)
    try {
      const emailSent = await this.emailService.sendVerificationEmail(email, verificationToken, nombres);
      if (emailSent) {
        this.logger.info('Verification email sent successfully', { email });
      } else {
        this.logger.warn('Verification email was not sent (check email service logs for details)', { email });
      }
    } catch (error) {
      this.logger.error('Failed to send verification email', error.stack, { email });
    }

    // Log de auditoría
    this.auditLogger.logUserRegistered(usuario.id, email, empresaId);

    // Generar tokens
    const tokens = await this.generateTokens(usuario, empresaId);

    this.logger.success('User registered successfully', {
      userId: usuario.id,
      email,
      tenantId: empresaId,
    });

    // Retornar información sin datos sensibles
    return {
      user: {
        id: usuario.id,
        email: usuario.email,
        nombres: usuario.persona.nombres,
        apellidos: usuario.persona.apellidos,
        emailVerificado: usuario.emailVerificado,
      },
      ...tokens,
    };
  }

  /**
   * Login de usuario
   */
  async login(loginDto: LoginDto, request?: any) {
    const { email, password, subdominioEmpresa } = loginDto;

    // Verificar si la cuenta está bloqueada
    const lockStatus = await this.securityService.isLockedOut(email, 'login');
    if (lockStatus.isLocked) {
      throw new UnauthorizedException(
        `Cuenta bloqueada. Intente nuevamente en ${Math.ceil((lockStatus.remainingTime || 0) / 60)} minutos.`
      );
    }

    // Buscar usuario con su persona
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
      include: {
        persona: true,
      },
    });

    // Obtener información real del cliente (mover antes de su uso)
    const clientInfo = request ? this.securityService.getClientInfo(request) : {
      ip: '127.0.0.1',
      userAgent: 'Unknown Device',
      device: 'API Login',
      platform: 'Unknown'
    };

    if (!usuario || !usuario.passwordHash || !usuario.isActive) {
      // Registrar intento fallido
      await this.securityService.recordFailedAttempt(email, 'login');

      // Log de auditoría para intento fallido
      this.auditLogger.logUserLogin(
        usuario?.id || 'unknown',
        email,
        clientInfo?.ip || 'unknown',
        false,
        'User not found or inactive',
      );

      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, usuario.passwordHash);
    if (!isPasswordValid) {
      // Registrar intento fallido
      await this.securityService.recordFailedAttempt(email, 'login');

      // Log de auditoría para contraseña incorrecta
      this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', false, 'Invalid password');

      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Determinar tenant
    let empresaId = undefined;
    let tenantRole = undefined;
    let tenantName = undefined;

    if (subdominioEmpresa) {
      const empresa = await this.prisma.empresa.findUnique({
        where: { subdominio: subdominioEmpresa },
      });

      if (empresa) {
        empresaId = empresa.id;
        tenantName = empresa.nombre;

        // Buscar rol del usuario en esta empresa
        const empresaUsuario = await this.prisma.empresaUsuarioRol.findUnique({
          where: {
            usuarioId_empresaId: {
              usuarioId: usuario.id,
              empresaId: empresa.id,
            },
          },
        });

        tenantRole = empresaUsuario?.rol || undefined;
      }
    }

    // Limpiar intentos fallidos exitosamente
    await this.securityService.clearFailedAttempts(email, 'login');

    // Actualizar último login
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(usuario, empresaId, tenantRole, tenantName, clientInfo);

    // Log de auditoría para login exitoso
    this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

    this.logger.info('User logged in successfully', {
      userId: usuario.id,
      email,
      tenantId: empresaId,
      ip: clientInfo?.ip,
    });

    return {
      user: {
        id: usuario.id,
        email: usuario.email,
        nombres: usuario.persona.nombres,
        apellidos: usuario.persona.apellidos,
        emailVerificado: usuario.emailVerificado,
        rolGlobal: usuario.rolGlobal,
      },
      tenant: empresaId ? {
        id: empresaId,
        name: tenantName,
        role: tenantRole,
      } : undefined,
      ...tokens,
    };
  }

  /**
   * Refresh token
   */
  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const usuario = await this.prisma.usuario.findUnique({
        where: { id: payload.sub },
        include: {
          persona: true,
        },
      });

      if (!usuario || !usuario.isActive) {
        throw new UnauthorizedException('Token inválido');
      }

      // Generar nuevos tokens
      return this.generateTokens(usuario);
    } catch (error) {
      throw new UnauthorizedException('Token de refresh inválido o expirado');
    }
  }

  /**
   * Generar tokens JWT
   */
  private async generateTokens(
    usuario: any,
    tenantId?: string,
    tenantRole?: any,
    tenantName?: string,
    clientInfo?: { ip: string; userAgent: string; device: string; platform: string },
  ) {
    // Crear sesión administrada
    const sessionId = await this.sessionService.createSession({
      userId: usuario.id,
      ipAddress: clientInfo?.ip,
      userAgent: clientInfo?.userAgent,
      deviceInfo: `${clientInfo?.device} (${clientInfo?.platform})`,
    }, 7 * 24 * 60 * 60 * 1000); // 7 días

    // Payload para access token
    const jwtPayload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      personaId: usuario.personaId,
      nombres: usuario.persona.nombres,
      apellidos: usuario.persona.apellidos,
      tenantId,
      tenantRole,
      tenantName,
      sessionId,
      loginMethod: 'local',
    };

    // Payload para refresh token
    const refreshPayload: RefreshTokenPayload = {
      sub: usuario.id,
      sessionId,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '24h'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get('JWT_EXPIRES_IN'),
      sessionId,
    };
  }

  /**
   * Validar usuario para JWT strategy
   */
  async validateUser(email: string, password: string): Promise<any> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
      include: {
        persona: true,
      },
    });

    if (usuario && usuario.passwordHash && usuario.isActive) {
      const isPasswordValid = await bcrypt.compare(password, usuario.passwordHash);
      if (isPasswordValid) {
        const { passwordHash, salt, ...result } = usuario;
        return result;
      }
    }
    return null;
  }

  /**
   * Logout (revocar sesión)
   */
  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      // Revocar sesión específica
      const revoked = await this.sessionService.revokeSession(sessionId, userId);
      if (revoked) {
        return {
          message: 'Sesión cerrada exitosamente',
          sessionId,
          revokedAt: new Date(),
        };
      }
    }

    // Si no hay sessionId, revocar todas las sesiones del usuario
    const revokedCount = await this.sessionService.revokeAllUserSessions(userId);
    return {
      message: `Se cerraron ${revokedCount} sesión(es) exitosamente`,
      revokedCount,
      revokedAt: new Date(),
    };
  }

  /**
   * Verificar email
   */
  async verifyEmail(token: string) {
    if (!token) {
      throw new BadRequestException('Token de verificación requerido');
    }

    // Buscar usuario con el token de verificación
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiracion: {
          gt: new Date(), // Token no expirado
        },
        emailVerificado: false, // Solo usuarios no verificados
      },
      include: {
        persona: true,
      },
    });

    if (!usuario) {
      throw new BadRequestException('Token de verificación inválido o expirado');
    }

    // Actualizar usuario como verificado
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        emailVerificado: true,
        resetToken: null,
        resetTokenExpiracion: null,
      },
    });

    // Log de auditoría
    this.auditLogger.logEmailVerified(usuario.id, usuario.email);

    // Enviar email de bienvenida (opcional)
    try {
      const emailSent = await this.emailService.sendWelcomeEmail(
        usuario.email,
        usuario.persona.nombres
      );
      if (emailSent) {
        this.logger.info('Welcome email sent successfully', { email: usuario.email });
      } else {
        this.logger.warn('Welcome email was not sent (check email service logs for details)', { email: usuario.email });
      }
    } catch (error) {
      this.logger.error('Failed to send welcome email', error.stack, { email: usuario.email });
    }

    this.logger.success('Email verified successfully', {
      userId: usuario.id,
      email: usuario.email,
    });

    return {
      success: true,
      message: 'Email verificado exitosamente',
      user: {
        id: usuario.id,
        email: usuario.email,
        nombres: usuario.persona.nombres,
        apellidos: usuario.persona.apellidos,
      },
    };
  }

  /**
   * Solicitar recuperación de contraseña
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email, subdominioEmpresa } = forgotPasswordDto;

    // Verificar si hay bloqueo por recuperación de contraseña
    const lockStatus = await this.securityService.isLockedOut(email, 'password_reset');
    if (lockStatus.isLocked) {
      throw new UnauthorizedException(
        `Demasiados intentos de recuperación. Intente nuevamente en ${Math.ceil((lockStatus.remainingTime || 0) / 60)} minutos.`
      );
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
    });

    if (!usuario) {
      // Registrar intento fallido pero no revelar si el email existe
      await this.securityService.recordFailedAttempt(email, 'password_reset');
      return { message: 'Si el email está registrado, recibirás instrucciones para recuperar tu contraseña' };
    }

    // Generar token de recuperación
    const resetToken = uuidv4();
    const resetTokenExpiracion = new Date(Date.now() + 3600000); // 1 hora

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        resetToken,
        resetTokenExpiracion,
      },
      include: {
        persona: true,
      },
    });

    // Limpiar intentos fallidos de recuperación de contraseña
    await this.securityService.clearFailedAttempts(email, 'password_reset');

    // Obtener información del usuario para el email
    const usuarioConPersona = await this.prisma.usuario.findUnique({
      where: { id: usuario.id },
      include: { persona: true },
    });

    // Enviar email de recuperación de contraseña
    try {
      const emailSent = await this.emailService.sendPasswordResetEmail(
        email,
        resetToken,
        usuarioConPersona.persona.nombres
      );
      if (emailSent) {
        this.logger.log(`Password recovery email sent to ${email}`);
      } else {
        this.logger.warn(`Password recovery email was not sent to ${email} (check email service logs for details)`);
      }
    } catch (error) {
      this.logger.error(`Failed to send password recovery email to ${email}:`, error);
    }

    return { message: 'Si el email está registrado, recibirás instrucciones para recuperar tu contraseña' };
  }

  /**
   * Resetear contraseña
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { resetToken, newPassword, confirmPassword } = resetPasswordDto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const usuario = await this.prisma.usuario.findFirst({
      where: {
        resetToken,
        resetTokenExpiracion: {
          gt: new Date(),
        },
      },
    });

    if (!usuario) {
      throw new BadRequestException('Token inválido o expirado');
    }

    // Hash de la nueva contraseña
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Actualizar usuario
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash,
        salt,
        resetToken: null,
        resetTokenExpiracion: null,
      },
    });

    return { message: 'Contraseña actualizada exitosamente' };
  }

  /**
   * Cambiar contraseña (usuario autenticado)
   */
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
    });

    if (!usuario || !usuario.passwordHash) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Verificar contraseña actual
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, usuario.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Contraseña actual incorrecta');
    }

    // Hash de la nueva contraseña
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Actualizar contraseña
    await this.prisma.usuario.update({
      where: { id: userId },
      data: {
        passwordHash,
        salt,
      },
    });

    // Log de auditoría
    this.auditLogger.logPasswordChanged(userId, usuario.email, userId);

    this.logger.success('Password changed successfully', { userId });

    return { message: 'Contraseña cambiada exitosamente' };
  }

  /**
   * Obtener sesiones activas del usuario
   */
  async getUserSessions(userId: string) {
    const sessions = await this.sessionService.getUserSessions(userId);

    return {
      sessions,
      totalSessions: sessions.length,
      activeDevices: [...new Set(sessions.map(s => s.deviceInfo))].length,
    };
  }

  /**
   * Revocar sesión específica
   */
  async revokeSession(userId: string, sessionId: string) {
    const revoked = await this.sessionService.revokeSession(sessionId, userId);

    if (!revoked) {
      throw new NotFoundException('Sesión no encontrada o no tienes permisos para revocarla');
    }

    return { message: 'Sesión revocada exitosamente', sessionId };
  }

  /**
   * Revocar todas las sesiones excepto la actual
   */
  async revokeAllOtherSessions(userId: string, currentSessionId: string) {
    const revokedCount = await this.sessionService.revokeAllOtherSessions(userId, currentSessionId);

    return {
      message: `Se revocaron ${revokedCount} sesión(es) de otros dispositivos`,
      revokedCount,
      currentSessionId,
    };
  }

  /**
   * Verificar si una sesión es válida
   */
  async validateSession(sessionId: string): Promise<boolean> {
    const session = await this.sessionService.getSession(sessionId);
    return session !== null && session.isActive;
  }
}
