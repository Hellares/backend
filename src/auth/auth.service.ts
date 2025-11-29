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
import { OAuth2Client } from 'google-auth-library';

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

    // Hash de la contraseña (bcrypt incluye el salt automáticamente)
    const passwordHash = await bcrypt.hash(password, 12);

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
        emailVerificado: false,
        telefonoVerificado: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpiracion: verificationTokenExpiration,
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
    const { email, password, subdominioEmpresa, rol: rolSeleccionado, loginMode } = loginDto;

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

    // Verificar que el email esté verificado
    if (!usuario.emailVerificado) {
      this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', false, 'Email not verified');
      throw new UnauthorizedException('Por favor verifica tu email antes de iniciar sesión. Revisa tu bandeja de entrada.');
    }

    // ========== LÓGICA DUAL MODE: Marketplace vs Management ==========

    // Caso 1: Usuario solicita explícitamente login en modo MARKETPLACE
    if (loginMode === 'marketplace') {
      this.logger.info('User logging in to Marketplace mode', {
        userId: usuario.id,
        email,
      });

      // Limpiar intentos fallidos
      await this.securityService.clearFailedAttempts(email, 'login');

      // Actualizar último login
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { lastLoginAt: new Date() },
      });

      // Generar tokens SIN contexto de tenant (marketplace mode)
      const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

      // Log de auditoría
      this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

      return {
        user: {
          id: usuario.id,
          email: usuario.email,
          nombres: usuario.persona.nombres,
          apellidos: usuario.persona.apellidos,
          emailVerificado: usuario.emailVerificado,
          rolGlobal: usuario.rolGlobal,
        },
        mode: 'marketplace',
        ...tokens,
      };
    }

    // Caso 2: Usuario solicita login en modo MANAGEMENT (debe tener subdominio)
    if (loginMode === 'management' && !subdominioEmpresa) {
      throw new BadRequestException('Modo "management" requiere especificar "subdominioEmpresa"');
    }

    // Caso 3: NO se especifica loginMode ni subdominio → Determinar automáticamente
    if (!loginMode && !subdominioEmpresa) {
      // Buscar todas las empresas donde el usuario tiene roles
      const empresasUsuario = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          usuarioId: usuario.id,
          isActive: true,
        },
        include: {
          empresa: {
            select: {
              id: true,
              nombre: true,
              subdominio: true,
              logo: true,
            },
          },
        },
      });

      if (empresasUsuario.length === 0) {
        // Usuario sin empresas → Login automático en modo MARKETPLACE
        this.logger.info('User has no companies, logging in to Marketplace mode', {
          userId: usuario.id,
          email,
        });

        // Limpiar intentos fallidos
        await this.securityService.clearFailedAttempts(email, 'login');

        // Actualizar último login
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { lastLoginAt: new Date() },
        });

        // Generar tokens SIN contexto de tenant
        const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

        // Log de auditoría
        this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

        return {
          user: {
            id: usuario.id,
            email: usuario.email,
            nombres: usuario.persona.nombres,
            apellidos: usuario.persona.apellidos,
            emailVerificado: usuario.emailVerificado,
            rolGlobal: usuario.rolGlobal,
          },
          mode: 'marketplace',
          ...tokens,
        };
      } else {
        // Usuario tiene empresas → Ofrecer opciones (Marketplace o Management)
        // Agrupar roles por empresa
        const empresasMap = new Map();

        empresasUsuario.forEach((rel) => {
          const empresaId = rel.empresa.id;

          if (!empresasMap.has(empresaId)) {
            empresasMap.set(empresaId, {
              id: rel.empresa.id,
              nombre: rel.empresa.nombre,
              subdominio: rel.empresa.subdominio,
              logo: rel.empresa.logo,
              roles: [],
            });
          }

          empresasMap.get(empresaId).roles.push(rel.rol);
        });

        const availableCompanies = Array.from(empresasMap.values());

        this.logger.info('User requires mode selection', {
          userId: usuario.id,
          email,
          companiesCount: availableCompanies.length,
        });

        // Limpiar intentos fallidos
        await this.securityService.clearFailedAttempts(email, 'login');

        // Retornar opciones de modo SIN generar tokens
        return {
          requiresSelection: true,
          message: '¿Qué deseas hacer?',
          user: {
            id: usuario.id,
            email: usuario.email,
            nombres: usuario.persona.nombres,
            apellidos: usuario.persona.apellidos,
            emailVerificado: usuario.emailVerificado,
          },
          options: [
            {
              type: 'marketplace',
              label: 'Ver Marketplace',
              description: 'Explorar productos y servicios de todas las empresas',
            },
            {
              type: 'management',
              label: 'Gestionar Empresas',
              description: 'Acceder al panel de gestión de tus empresas',
              availableCompanies,
            },
          ],
        };
      }
    }

    // Determinar tenant y rol(es) cuando SÍ se proporciona subdominio
    let empresaId = undefined;
    let tenantRole = undefined;
    let tenantName = undefined;
    let availableRoles = undefined;

    if (subdominioEmpresa) {
      const empresa = await this.prisma.empresa.findUnique({
        where: { subdominio: subdominioEmpresa },
      });

      if (!empresa) {
        throw new NotFoundException('Empresa no encontrada');
      }

      empresaId = empresa.id;
      tenantName = empresa.nombre;

      // Buscar TODOS los roles del usuario en esta empresa
      const rolesUsuario = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          usuarioId: usuario.id,
          empresaId: empresa.id,
          isActive: true,
        },
      });

      if (rolesUsuario.length === 0) {
        throw new UnauthorizedException('No tienes acceso a esta empresa');
      }

      availableRoles = rolesUsuario.map(r => r.rol);

      // Determinar qué rol usar en la sesión
      if (rolSeleccionado) {
        // Verificar que el usuario tenga el rol solicitado
        const tieneRol = rolesUsuario.some(r => r.rol === rolSeleccionado);
        if (!tieneRol) {
          throw new UnauthorizedException(
            `No tienes el rol "${rolSeleccionado}" en esta empresa. Roles disponibles: ${availableRoles.join(', ')}`
          );
        }
        tenantRole = rolSeleccionado;
      } else {
        // Si tiene múltiples roles y no especificó uno, usar el primero
        tenantRole = rolesUsuario[0].rol;
      }
    }

    // Limpiar intentos fallidos exitosamente
    await this.securityService.clearFailedAttempts(email, 'login');

    // Actualizar último login
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(usuario, empresaId, tenantRole, tenantName, clientInfo, availableRoles);

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
      mode: empresaId ? 'management' : 'marketplace',
      tenant: empresaId ? {
        id: empresaId,
        name: tenantName,
        role: tenantRole, // Rol activo en esta sesión
        availableRoles: availableRoles, // Todos los roles disponibles del usuario en esta empresa
      } : undefined,
      ...tokens,
    };
  }

  /**
   * Refresh token con rotación (genera nuevo refresh token)
   */
  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    try {
      const payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      // Validar que la sesión esté activa
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

      const usuario = await this.prisma.usuario.findUnique({
        where: { id: payload.sub },
        include: {
          persona: true,
        },
      });

      if (!usuario || !usuario.isActive) {
        throw new UnauthorizedException('Token inválido');
      }

      // ROTACIÓN DE REFRESH TOKEN:
      // Agregar el refresh token anterior a la blacklist para evitar reutilización
      if (payload.sessionId) {
        const oldTokenKey = `used_refresh_token:${refreshToken.substring(0, 32)}`;
        const expirySeconds = 7 * 24 * 60 * 60; // 7 días (mismo tiempo que el refresh token)
        await this.sessionService['redisService'].setex(oldTokenKey, expirySeconds, 'used');
      }

      // Generar NUEVOS tokens (incluyendo nuevo refresh token)
      // Recuperar contexto de la sesión (tenant info + client info)
      const session = payload.sessionId ? await this.sessionService.getSession(payload.sessionId) : null;

      const clientInfo = session ? {
        ip: session.ipAddress || '127.0.0.1',
        userAgent: session.userAgent || 'Unknown',
        device: session.deviceInfo || 'Unknown Device',
        platform: 'Unknown'
      } : undefined;

      // Mantener el contexto del tenant de la sesión original
      return this.generateTokens(
        usuario,
        session?.tenantId,
        session?.tenantRole,
        session?.tenantName,
        clientInfo,
        session?.tenantRoles
      );
    } catch (error) {
      // Verificar si el refresh token ya fue usado (prevenir replay attacks)
      if (refreshToken && error.name !== 'TokenExpiredError') {
        const tokenKey = `used_refresh_token:${refreshToken.substring(0, 32)}`;
        const wasUsed = await this.sessionService['redisService'].get(tokenKey);
        if (wasUsed) {
          this.logger.warn('Intento de reutilizar refresh token', { token: refreshToken.substring(0, 20) });
          throw new UnauthorizedException('Refresh token ya fue utilizado. Por seguridad, por favor inicia sesión nuevamente.');
        }
      }

      if (error instanceof UnauthorizedException) {
        throw error;
      }
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
    tenantRoles?: any[],
  ) {
    // Crear sesión administrada con contexto tenant
    const sessionId = await this.sessionService.createSession({
      userId: usuario.id,
      ipAddress: clientInfo?.ip,
      userAgent: clientInfo?.userAgent,
      deviceInfo: `${clientInfo?.device} (${clientInfo?.platform})`,
      tenantId,
      tenantRole,
      tenantName,
      tenantRoles,
    }, 7 * 24 * 60 * 60 * 1000); // 7 días

    // Payload para access token
    const jwtPayload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      personaId: usuario.personaId,
      nombres: usuario.persona.nombres,
      apellidos: usuario.persona.apellidos,
      tenantId,
      tenantRole,      // Rol principal/seleccionado
      tenantRoles,     // Todos los roles disponibles en esta empresa
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
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
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
        const { passwordHash, ...result } = usuario;
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
        emailVerificationToken: token,
        emailVerificationExpiracion: {
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
        emailVerificationToken: null,
        emailVerificationExpiracion: null,
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
   * Reenviar email de verificación
   */
  async resendVerificationEmail(email: string) {
    // Buscar usuario por email
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
      include: {
        persona: true,
      },
    });

    if (!usuario) {
      // No revelar si el email existe o no por seguridad
      // Pero retornar mensaje genérico de éxito
      return {
        success: true,
        message: 'Si el email está registrado, recibirás un correo de verificación',
      };
    }

    // Verificar si el email ya está verificado
    if (usuario.emailVerificado) {
      throw new BadRequestException('El email ya está verificado');
    }

    // Verificar cooldown: no reenviar si se envió hace menos de 60 segundos
    if (usuario.emailVerificationExpiracion && usuario.emailVerificationExpiracion > new Date()) {
      // Calcular cuándo fue creado el token actual
      // emailVerificationExpiracion = createdAt + 24 horas
      // Por lo tanto: createdAt = emailVerificationExpiracion - 24 horas
      const tokenCreatedAt = new Date(usuario.emailVerificationExpiracion.getTime() - 24 * 60 * 60 * 1000);
      const secondsSinceCreation = Math.floor((new Date().getTime() - tokenCreatedAt.getTime()) / 1000);
      const cooldownSeconds = 60; // Cooldown de 60 segundos

      if (secondsSinceCreation < cooldownSeconds) {
        const remainingSeconds = cooldownSeconds - secondsSinceCreation;
        throw new BadRequestException(
          `Ya se envió un email de verificación recientemente. Podrás solicitar uno nuevo en ${remainingSeconds} segundo(s). Por favor, revisa tu bandeja de entrada o spam.`
        );
      }
    }

    // Generar nuevo token de verificación
    const verificationToken = uuidv4();
    const verificationTokenExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    // Actualizar usuario con nuevo token
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpiracion: verificationTokenExpiration,
      },
    });

    // Enviar email de verificación
    try {
      const emailSent = await this.emailService.sendVerificationEmail(
        usuario.email,
        verificationToken,
        usuario.persona.nombres
      );

      if (emailSent) {
        this.logger.info('Verification email resent successfully', { email: usuario.email });
      } else {
        this.logger.warn('Verification email could not be sent', { email: usuario.email });
        throw new BadRequestException('No se pudo enviar el email de verificación. Intenta nuevamente más tarde.');
      }
    } catch (error) {
      this.logger.error('Failed to resend verification email', error.stack, { email: usuario.email });
      throw new BadRequestException('Error al enviar el email de verificación. Intenta nuevamente más tarde.');
    }

    this.logger.success('Verification email resent successfully', {
      userId: usuario.id,
      email: usuario.email,
    });

    return {
      success: true,
      message: 'Email de verificación enviado. Por favor, revisa tu bandeja de entrada o spam.',
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

    // Hash de la nueva contraseña (bcrypt incluye el salt automáticamente)
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Actualizar usuario
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash,
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

    // Hash de la nueva contraseña (bcrypt incluye el salt automáticamente)
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Actualizar contraseña
    await this.prisma.usuario.update({
      where: { id: userId },
      data: {
        passwordHash,
      },
    });

    // Log de auditoría
    this.auditLogger.logPasswordChanged(userId, usuario.email, userId);

    this.logger.success('Password changed successfully', { userId });

    return { message: 'Contraseña cambiada exitosamente' };
  }

  /**
   * Autenticación con Google (verificación de ID Token)
   */
  async authenticateWithGoogle(idToken: string, request?: any, subdominioEmpresa?: string, loginMode?: 'marketplace' | 'management') {
    try {
      // Inicializar cliente de Google
      const client = new OAuth2Client(this.configService.get<string>('GOOGLE_CLIENT_ID'));

      // Aceptar múltiples Client IDs (Web y Android)
      const webClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
      const androidClientId = this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID');

      // Verificar el ID token con Google, aceptando ambos Client IDs
      const ticket = await client.verifyIdToken({
        idToken,
        audience: [webClientId, androidClientId].filter(Boolean), // Filtrar valores nulos/undefined
      });

      const payload = ticket.getPayload();

      if (!payload || !payload.email) {
        throw new UnauthorizedException('Token de Google inválido');
      }

      // Extraer información del usuario desde el token de Google
      const {
        sub: googleId,
        email,
        given_name: nombres,
        family_name: apellidos,
        picture: photoUrl,
        email_verified: emailVerified,
      } = payload;

      // Obtener información del cliente
      const clientInfo = request ? this.securityService.getClientInfo(request) : {
        ip: '127.0.0.1',
        userAgent: 'Unknown Device',
        device: 'Mobile App',
        platform: 'Unknown'
      };

      // Buscar si ya existe un AuthProvider con este googleId
      let authProvider = await this.prisma.authProvider.findUnique({
        where: {
          provider_providerId: {
            provider: 'GOOGLE',
            providerId: googleId,
          },
        },
        include: {
          usuario: {
            include: {
              persona: true,
            },
          },
        },
      });

      let usuario;

      if (authProvider) {
        // Usuario ya existe con Google OAuth
        usuario = authProvider.usuario;

        if (!usuario.isActive) {
          throw new UnauthorizedException('Cuenta desactivada');
        }

        // Actualizar último login
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { lastLoginAt: new Date() },
        });
      } else {
        // Verificar si ya existe un usuario con este email (registrado con email/password)
        const existingUser = await this.prisma.usuario.findUnique({
          where: { email },
          include: {
            persona: true,
          },
        });

        if (existingUser) {
          // Vincular cuenta existente con Google
          usuario = existingUser;

          // Crear AuthProvider para vincular Google
          await this.prisma.authProvider.create({
            data: {
              userId: usuario.id,
              provider: 'GOOGLE',
              providerId: googleId,
              email,
              isActive: true,
            },
          });

          this.logger.info('Existing user linked with Google', {
            userId: usuario.id,
            email,
          });
        } else {
          // Crear nuevo usuario con Google OAuth
          // Primero crear la persona
          const persona = await this.prisma.persona.create({
            data: {
              nombres: nombres || 'Usuario',
              apellidos: apellidos || 'Google',
              email,
              esUsuario: true,
            },
          });

          // Crear el usuario (sin contraseña porque es OAuth)
          usuario = await this.prisma.usuario.create({
            data: {
              personaId: persona.id,
              email,
              emailVerificado: emailVerified || true, // Google ya verificó el email
              telefonoVerificado: false,
            },
            include: {
              persona: true,
            },
          });

          // Crear AuthProvider
          await this.prisma.authProvider.create({
            data: {
              userId: usuario.id,
              provider: 'GOOGLE',
              providerId: googleId,
              email,
              isActive: true,
            },
          });

          // Log de auditoría
          this.auditLogger.logUserRegistered(usuario.id, email, null);

          this.logger.success('New user created via Google OAuth', {
            userId: usuario.id,
            email,
          });
        }
      }

      // ========== LÓGICA DUAL MODE: Marketplace vs Management (Google) ==========

      // Caso 1: Usuario solicita explícitamente login en modo MARKETPLACE
      if (loginMode === 'marketplace') {
        this.logger.info('User logging in to Marketplace mode (Google)', {
          userId: usuario.id,
          email,
        });

        // Actualizar último login
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { lastLoginAt: new Date() },
        });

        // Generar tokens SIN contexto de tenant (marketplace mode)
        const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

        // Log de auditoría
        this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

        return {
          user: {
            id: usuario.id,
            email: usuario.email,
            nombres: usuario.persona.nombres,
            apellidos: usuario.persona.apellidos,
            emailVerificado: usuario.emailVerificado,
            rolGlobal: usuario.rolGlobal,
            photoUrl,
          },
          mode: 'marketplace',
          ...tokens,
        };
      }

      // Caso 2: Usuario solicita login en modo MANAGEMENT (debe tener subdominio)
      if (loginMode === 'management' && !subdominioEmpresa) {
        throw new BadRequestException('Modo "management" requiere especificar "subdominioEmpresa"');
      }

      // Caso 3: NO se especifica loginMode ni subdominio → Determinar automáticamente
      if (!loginMode && !subdominioEmpresa) {
        // Buscar todas las empresas donde el usuario tiene roles
        const empresasUsuario = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            usuarioId: usuario.id,
            isActive: true,
          },
          include: {
            empresa: {
              select: {
                id: true,
                nombre: true,
                subdominio: true,
                logo: true,
              },
            },
          },
        });

        if (empresasUsuario.length === 0) {
          // Usuario sin empresas → Login automático en modo MARKETPLACE
          this.logger.info('User has no companies, logging in to Marketplace mode (Google)', {
            userId: usuario.id,
            email,
          });

          // Actualizar último login
          await this.prisma.usuario.update({
            where: { id: usuario.id },
            data: { lastLoginAt: new Date() },
          });

          // Generar tokens SIN contexto de tenant
          const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

          // Log de auditoría
          this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

          return {
            user: {
              id: usuario.id,
              email: usuario.email,
              nombres: usuario.persona.nombres,
              apellidos: usuario.persona.apellidos,
              emailVerificado: usuario.emailVerificado,
              rolGlobal: usuario.rolGlobal,
              photoUrl,
            },
            mode: 'marketplace',
            ...tokens,
          };
        } else {
          // Usuario tiene empresas → Ofrecer opciones (Marketplace o Management)
          // Agrupar roles por empresa
          const empresasMap = new Map();

          empresasUsuario.forEach((rel) => {
            const empresaId = rel.empresa.id;

            if (!empresasMap.has(empresaId)) {
              empresasMap.set(empresaId, {
                id: rel.empresa.id,
                nombre: rel.empresa.nombre,
                subdominio: rel.empresa.subdominio,
                logo: rel.empresa.logo,
                roles: [],
              });
            }

            empresasMap.get(empresaId).roles.push(rel.rol);
          });

          const availableCompanies = Array.from(empresasMap.values());

          this.logger.info('User requires mode selection (Google login)', {
            userId: usuario.id,
            email,
            companiesCount: availableCompanies.length,
          });

          // Retornar opciones de modo SIN generar tokens
          return {
            requiresSelection: true,
            message: '¿Qué deseas hacer?',
            user: {
              id: usuario.id,
              email: usuario.email,
              nombres: usuario.persona.nombres,
              apellidos: usuario.persona.apellidos,
              emailVerificado: usuario.emailVerificado,
              photoUrl,
            },
            options: [
              {
                type: 'marketplace',
                label: 'Ver Marketplace',
                description: 'Explorar productos y servicios de todas las empresas',
              },
              {
                type: 'management',
                label: 'Gestionar Empresas',
                description: 'Acceder al panel de gestión de tus empresas',
                availableCompanies,
              },
            ],
          };
        }
      }

      // Determinar tenant y rol(es) cuando SÍ se proporciona subdominio
      let empresaId = undefined;
      let tenantRole = undefined;
      let tenantName = undefined;
      let availableRoles = undefined;

      if (subdominioEmpresa) {
        const empresa = await this.prisma.empresa.findUnique({
          where: { subdominio: subdominioEmpresa },
        });

        if (!empresa) {
          throw new NotFoundException('Empresa no encontrada');
        }

        empresaId = empresa.id;
        tenantName = empresa.nombre;

        // Buscar TODOS los roles del usuario en esta empresa
        const rolesUsuario = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            usuarioId: usuario.id,
            empresaId: empresa.id,
            isActive: true,
          },
        });

        if (rolesUsuario.length === 0) {
          throw new UnauthorizedException('No tienes acceso a esta empresa');
        }

        availableRoles = rolesUsuario.map(r => r.rol);

        // Si tiene múltiples roles, usar el primero
        tenantRole = rolesUsuario[0].rol;
      }

      // Actualizar último login
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { lastLoginAt: new Date() },
      });

      // Generar tokens JWT propios del sistema
      const tokens = await this.generateTokens(usuario, empresaId, tenantRole, tenantName, clientInfo, availableRoles);

      // Log de auditoría para login exitoso
      this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

      this.logger.info('User authenticated with Google successfully', {
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
          photoUrl,
        },
        mode: empresaId ? 'management' : 'marketplace',
        tenant: empresaId ? {
          id: empresaId,
          name: tenantName,
          role: tenantRole,
          availableRoles: availableRoles,
        } : undefined,
        ...tokens,
      };
    } catch (error) {
      this.logger.error('Google authentication failed', error.stack);

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Error al autenticar con Google: ' + error.message);
    }
  }

  /**
   * Obtener sesiones activas del usuario
   */
  async getUserSessions(userId: string) {
    const sessions = await this.sessionService.getUserSessions(userId);

    return {
      sessions,
      totalSessions: sessions.length,
      activeDevices: Array.from(new Set(sessions.map(s => s.deviceInfo))).length,
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
