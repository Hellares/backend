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
import { Rol } from '@prisma/client';
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
import { SetPasswordDto } from './dto/set-password.dto';
import { CheckAuthMethodsDto } from './dto/check-auth-methods.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AutorizarOperacionDto } from './dto/autorizar-operacion.dto';
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
   * Detecta el tipo de credencial (EMAIL, DNI, TELEFONO)
   */
  private detectarTipoCredencial(credencial: string): 'EMAIL' | 'DNI' | 'TELEFONO' {
    // Patrón para email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Patrón para DNI peruano (8 dígitos)
    const dniRegex = /^\d{8}$/;
    // Patrón para teléfono (9-15 dígitos, puede empezar con +)
    const telefonoRegex = /^\+?\d{9,15}$/;

    if (emailRegex.test(credencial)) {
      return 'EMAIL';
    }
    if (dniRegex.test(credencial)) {
      return 'DNI';
    }
    if (telefonoRegex.test(credencial)) {
      return 'TELEFONO';
    }

    // Por defecto, asumir que es email si no coincide con nada
    return 'EMAIL';
  }

  /**
   * Registro de nuevo usuario
   */
  async register(registerDto: RegisterDto, tenantId?: string) {
    const { email, password, nombres, apellidos, telefono, dni, subdominioEmpresa, esClienteSinEmail } = registerDto;

    // Validar que se proporcione al menos email o DNI
    if (!email && !dni) {
      throw new BadRequestException('Debe proporcionar email o DNI');
    }

    // Verificar si el email ya existe (solo si se proporciona)
    if (email) {
      const existingUser = await this.prisma.usuario.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new ConflictException('El email ya está registrado');
      }
    }

    // Verificar si el DNI ya existe (solo si se proporciona)
    if (dni) {
      const existingPersona = await this.prisma.persona.findUnique({
        where: { dni },
        include: { usuario: true },
      });

      if (existingPersona && existingPersona.usuario) {
        throw new ConflictException('El DNI ya está registrado');
      }
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

    // Determinar la contraseña: si es cliente sin email, usar DNI como contraseña temporal
    const passwordToHash = esClienteSinEmail && dni ? dni : password;
    if (!passwordToHash) {
      throw new BadRequestException('Debe proporcionar una contraseña');
    }

    // Hash de la contraseña (bcrypt incluye el salt automáticamente)
    const passwordHash = await bcrypt.hash(passwordToHash, 12);

    // Determinar método principal de login
    const metodoPrincipalLogin = esClienteSinEmail ? 'DNI' : (email ? 'EMAIL' : 'DNI');

    // Crear la persona primero
    const persona = await this.prisma.persona.create({
      data: {
        nombres,
        apellidos,
        telefono,
        dni,
        esUsuario: true,
        esCliente: esClienteSinEmail ? true : undefined,
      },
    });

    // Generar token de verificación de email (solo si hay email)
    const verificationToken = email ? uuidv4() : null;
    const verificationTokenExpiration = email ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null; // 24 horas

    // Crear el usuario
    const usuario = await this.prisma.usuario.create({
      data: {
        personaId: persona.id,
        email: email || null,
        passwordHash,
        emailVerificado: esClienteSinEmail ? true : false, // Si no tiene email, marcar como verificado
        telefonoVerificado: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpiracion: verificationTokenExpiration,
        authMethodsCount: 1, // Usuario tiene método PASSWORD
        metodoPrincipalLogin: metodoPrincipalLogin as any,
        requiereCambioPassword: esClienteSinEmail ? true : false, // Clientes sin email deben cambiar password
        dniVerificado: esClienteSinEmail && dni ? true : false,
        rolGlobal: esClienteSinEmail ? 'CLIENTE' : null,
      },
      include: {
        persona: true,
      },
    });

    // Crear AuthProvider para método PASSWORD
    await this.prisma.authProvider.create({
      data: {
        userId: usuario.id,
        provider: 'PASSWORD',
        providerId: usuario.id, // Para PASSWORD, usamos el userId como providerId
        email: email || dni || usuario.id, // Usar email, DNI o userId como fallback
        isActive: true,
      },
    });

    // Si hay una empresa, crear la relación empresa-usuario
    if (empresaId) {
      // Crear relación persona-empresa (para visibilidad en listados de clientes)
      await this.prisma.empresaPersona.create({
        data: {
          personaId: persona.id,
          empresaId,
          rol: 'CLIENTE',
          isActive: true,
        },
      });

      await this.prisma.empresaUsuarioRol.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          rol: 'CLIENTE', // Rol por defecto
        },
      });

      // Crear registro de cliente
      await this.prisma.registroCliente.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          tipoRegistro: 'AUTO_REGISTRO',
          canalRegistro: 'WEB',
          estado: 'AUTO_APROBADO',
        },
      });
    }

    // Enviar email de verificación solo si hay email (no bloquear el registro si falla)
    if (email && verificationToken) {
      try {
        const emailSent = await this.emailService.sendVerificationEmail(email, verificationToken, nombres);
        if (emailSent) {
          this.logger.info('Verification email sent successfully', { email });
        } else {
          this.logger.warn('Verification email was not sent (check email service logs for details)', { email });
        }
      } catch (error: any) {
        this.logger.error('Failed to send verification email', error?.stack, { email });
      }
    }

    // Log de auditoría
    this.auditLogger.logUserRegistered(usuario.id, email || dni || usuario.id, empresaId);

    
    // Generar tokens
    const tokens = await this.generateTokens(usuario, empresaId);

    this.logger.success('User registered successfully', {
      userId: usuario.id,
      email: email || dni,
      tenantId: empresaId,
      metodoPrincipalLogin,
    });

    // Retornar información sin datos sensibles
    return {
      user: this.buildUserResponse(usuario, {
        requiereCambioPassword: usuario.requiereCambioPassword,
      }),
      ...tokens,
    };
  }

  /**
   * Login de usuario
   */
  async login(loginDto: LoginDto, request?: any) {
    const { credencial: rawCredencial, password, subdominioEmpresa, rol: rolSeleccionado, loginMode } = loginDto;

    // Detectar tipo de credencial sobre el valor recortado
    const trimmedCredencial = rawCredencial.trim();
    const tipoCredencial = this.detectarTipoCredencial(trimmedCredencial);

    // Normalizar email a lowercase para que lookup, lockout y audit log sean consistentes.
    // Sin esto, `Mathidev@x.com` y `mathidev@x.com` cuentan como cuentas distintas en el lockout.
    const credencial = tipoCredencial === 'EMAIL'
      ? trimmedCredencial.toLowerCase()
      : trimmedCredencial;

    // Obtener IP del cliente para lockout combinado credencial+IP
    const clientInfo = request ? this.securityService.getClientInfo(request) : {
      ip: '127.0.0.1',
      userAgent: 'Unknown Device',
      device: 'API Login',
      platform: 'Unknown'
    };

    // Verificar si la cuenta está bloqueada (por credencial o IP+credencial)
    const lockStatus = await this.securityService.isLockedOut(credencial, 'login', clientInfo.ip);
    if (lockStatus.isLocked) {
      throw new UnauthorizedException(
        `Cuenta bloqueada. Intente nuevamente en ${Math.ceil((lockStatus.remainingTime || 0) / 60)} minutos.`
      );
    }

    // Buscar usuario según el tipo de credencial
    let usuario: any;

    if (tipoCredencial === 'EMAIL') {
      usuario = await this.prisma.usuario.findUnique({
        where: { email: credencial },
        include: {
          persona: true,
        },
      });
    } else if (tipoCredencial === 'DNI') {
      // Buscar por DNI en Persona, luego obtener Usuario
      const persona = await this.prisma.persona.findUnique({
        where: { dni: credencial },
        include: {
          usuario: true,
        },
      });

      if (persona && persona.usuario) {
        usuario = await this.prisma.usuario.findUnique({
          where: { id: persona.usuario.id },
          include: {
            persona: true,
          },
        });
      }
    } else if (tipoCredencial === 'TELEFONO') {
      usuario = await this.prisma.usuario.findUnique({
        where: { telefono: credencial },
        include: {
          persona: true,
        },
      });
    }

    if (!usuario || !usuario.isActive) {
      // Registrar intento fallido
      await this.securityService.recordFailedAttempt(credencial, 'login', clientInfo.ip);

      // Log de auditoría para intento fallido
      this.auditLogger.logUserLogin(
        usuario?.id || 'unknown',
        credencial,
        clientInfo?.ip || 'unknown',
        false,
        'User not found or inactive',
      );

      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar que el usuario tenga método de autenticación PASSWORD
    const passwordProvider = await this.prisma.authProvider.findFirst({
      where: {
        userId: usuario.id,
        provider: 'PASSWORD',
        isActive: true,
      },
    });

    if (!passwordProvider || !usuario.passwordHash) {
      // Registrar intento fallido
      await this.securityService.recordFailedAttempt(credencial, 'login', clientInfo.ip);

      // Log de auditoría para método no disponible
      this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', false, 'Password login not available for this account');

      throw new UnauthorizedException('Credenciales inválidas. Esta cuenta no tiene configurado el login con contraseña.');
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, usuario.passwordHash);
    if (!isPasswordValid) {
      // Registrar intento fallido
      await this.securityService.recordFailedAttempt(credencial, 'login', clientInfo.ip);

      // Log de auditoría para contraseña incorrecta
      this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', false, 'Invalid password');

      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar que el email esté verificado (solo si el usuario tiene email y metodoPrincipalLogin es EMAIL)
    if (usuario.email && usuario.metodoPrincipalLogin === 'EMAIL' && !usuario.emailVerificado) {
      this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', false, 'Email not verified');
      throw new UnauthorizedException('Por favor verifica tu email antes de iniciar sesión. Revisa tu bandeja de entrada.');
    }

    // Si el usuario requiere cambio de password, generar tokens temporales para permitir el cambio
    if (usuario.requiereCambioPassword) {
      // Log de auditoría para login exitoso (aunque requiera cambio de password)
      this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', true);

      // Generar tokens temporales sin actualizar lastLoginAt
      // Estos tokens solo permitirán cambiar la contraseña
      const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

      return {
        user: this.buildUserResponse(usuario, { requiereCambioPassword: true }),
        message: 'Debe cambiar su contraseña antes de continuar',
        ...tokens, // Incluir tokens para permitir cambio de contraseña
      };
    }

    // ========== LÓGICA DUAL MODE: Marketplace vs Management ==========

    // Caso 1: Usuario solicita explícitamente login en modo MARKETPLACE
    if (loginMode === 'marketplace') {
      this.logger.info('User logging in to Marketplace mode', {
        userId: usuario.id,
        credencial,
      });

      // Limpiar intentos fallidos
      await this.securityService.clearFailedAttempts(credencial, 'login', clientInfo.ip);

      // Actualizar último login
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { lastLoginAt: new Date() },
      });

      // Generar tokens SIN contexto de tenant (marketplace mode)
      const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

      // Log de auditoría
      this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', true);

      return {
        user: this.buildUserResponse(usuario),
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
          credencial,
        });

        // Limpiar intentos fallidos
        await this.securityService.clearFailedAttempts(credencial, 'login', clientInfo.ip);

        // Actualizar último login
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { lastLoginAt: new Date() },
        });

        // Generar tokens SIN contexto de tenant
        const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

        // Log de auditoría
        this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', true);

        return {
          user: this.buildUserResponse(usuario),
          mode: 'marketplace',
          ...tokens,
        };
      } else {
        // Usuario tiene empresas → Agrupar roles por empresa
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

        // Filtrar: solo empresas donde tiene roles de gestión (no-CLIENTE)
        const managementCompanies = Array.from(empresasMap.values()).filter(
          (company: any) => company.roles.some((r: string) => r !== Rol.CLIENTE),
        );

        // Limpiar intentos fallidos
        await this.securityService.clearFailedAttempts(credencial, 'login', clientInfo.ip);

        // Actualizar último login
        await this.prisma.usuario.update({
          where: { id: usuario.id },
          data: { lastLoginAt: new Date() },
        });

        // Generar tokens sin contexto de tenant
        const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

        // Log de auditoría
        this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', true);

        // Si solo tiene roles CLIENTE → Marketplace directo
        if (managementCompanies.length === 0) {
          this.logger.info('User has only CLIENTE roles, logging in to Marketplace mode', {
            userId: usuario.id,
            credencial,
          });

          return {
            user: this.buildUserResponse(usuario),
            mode: 'marketplace',
            ...tokens,
          };
        }

        // Tiene empresas de gestión → Ofrecer opciones
        this.logger.info('User requires mode selection', {
          userId: usuario.id,
          credencial,
          managementCompanies: managementCompanies.length,
        });

        return {
          requiresSelection: true,
          message: '¿Qué deseas hacer?',
          user: this.buildUserResponse(usuario),
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
              availableCompanies: managementCompanies,
            },
          ],
          ...tokens,
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
    await this.securityService.clearFailedAttempts(credencial, 'login', clientInfo.ip);

    // Actualizar último login
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(usuario, empresaId, tenantRole, tenantName, clientInfo, availableRoles);

    // Log de auditoría para login exitoso
    this.auditLogger.logUserLogin(usuario.id, credencial, clientInfo?.ip || 'unknown', true);

    this.logger.info('User logged in successfully', {
      userId: usuario.id,
      credencial,
      metodoPrincipalLogin: usuario.metodoPrincipalLogin,
      tenantId: empresaId,
      ip: clientInfo?.ip,
    });

    return {
      user: this.buildUserResponse(usuario, {
        requiereCambioPassword: usuario.requiereCambioPassword,
      }),
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
        const tokenHash = refreshToken.substring(0, 32);
        const expirySeconds = 7 * 24 * 60 * 60; // 7 días
        await this.sessionService.addToTokenBlacklist(tokenHash, expirySeconds);
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

      // Re-consultar roles actuales desde la BD para mantener permisos sincronizados
      let tenantRole = session?.tenantRole;
      let tenantRoles = session?.tenantRoles;

      if (session?.tenantId) {
        const currentRoles = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            usuarioId: usuario.id,
            empresaId: session.tenantId,
            isActive: true,
            deletedAt: null,
          },
          select: { rol: true },
        });

        if (currentRoles.length === 0) {
          // Usuario ya no tiene acceso a esta empresa — forzar logout
          throw new UnauthorizedException('Ya no tienes acceso a esta empresa. Por favor, inicia sesión nuevamente.');
        }

        const freshRoles = currentRoles.map(r => r.rol);
        tenantRoles = freshRoles;

        // Si el rol activo fue removido, usar el primero disponible
        if (tenantRole && !freshRoles.includes(tenantRole as any)) {
          tenantRole = freshRoles[0];
        }

        // Actualizar session en Redis con roles frescos
        if (payload.sessionId) {
          await this.sessionService.updateSessionTenant(payload.sessionId, {
            tenantId: session.tenantId,
            tenantRole,
            tenantName: session.tenantName,
            tenantRoles,
          });
        }
      }

      return this.generateTokens(
        usuario,
        session?.tenantId,
        tenantRole,
        session?.tenantName,
        clientInfo,
        tenantRoles
      );
    } catch (error: any) {
      // Verificar si el refresh token ya fue usado (prevenir replay attacks)
      if (refreshToken && error?.name !== 'TokenExpiredError') {
        const tokenHash = refreshToken.substring(0, 32);
        const wasUsed = await this.sessionService.isTokenBlacklisted(tokenHash);
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
      rolGlobal: usuario.rolGlobal,
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
    } catch (error: any) {
      this.logger.error('Failed to send welcome email', error?.stack, { email: usuario.email });
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
    } catch (error: any) {
      this.logger.error('Failed to resend verification email', error?.stack, { email: usuario.email });
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
    } catch (error: any) {
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

    // Revocar TODAS las sesiones del usuario (reset-password no tiene sesión actual)
    const revokedCount = await this.sessionService.revokeAllUserSessions(usuario.id);
    this.logger.info('All sessions revoked after password reset', {
      userId: usuario.id,
      revokedCount,
    });

    return { message: 'Contraseña actualizada exitosamente' };
  }

  /**
   * Cambiar contraseña (usuario autenticado)
   */
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto, currentSessionId?: string) {
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

    // Actualizar contraseña y resetear flag de cambio obligatorio
    await this.prisma.usuario.update({
      where: { id: userId },
      data: {
        passwordHash,
        requiereCambioPassword: false,
        ultimoCambioPassword: new Date(),
      },
    });

    // Revocar TODAS las sesiones, incluida la actual. Forzamos re-login
    // para que el usuario use la nueva contraseña explícitamente y la app
    // descarte cualquier estado en memoria asociado al token viejo.
    const revokedCount = await this.sessionService.revokeAllUserSessions(userId);
    this.logger.info('All sessions revoked after password change', {
      userId,
      revokedCount,
    });

    // Log de auditoría
    this.auditLogger.logPasswordChanged(userId, usuario.email || usuario.id, userId);

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
        // Si el AuthProvider está desactivado, no permitir login con esta cuenta Google
        // (caso típico: usuario revocó la vinculación o admin la desactivó tras un cambio de email).
        if (!authProvider.isActive) {
          throw new UnauthorizedException(
            'Esta cuenta de Google ya no está vinculada. Inicia sesión con tu método actual.',
          );
        }

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

          // Incrementar contador de métodos de autenticación
          await this.prisma.usuario.update({
            where: { id: usuario.id },
            data: {
              authMethodsCount: {
                increment: 1,
              },
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
              authMethodsCount: 1, // Usuario tiene método GOOGLE
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
          user: this.buildUserResponse(usuario, { photoUrl }),
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
            user: this.buildUserResponse(usuario, { photoUrl }),
            mode: 'marketplace',
            ...tokens,
          };
        } else {
          // Usuario tiene empresas → Agrupar roles por empresa
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

          // Filtrar: solo empresas donde tiene roles de gestión (no-CLIENTE)
          const managementCompanies = Array.from(empresasMap.values()).filter(
            (company: any) => company.roles.some((r: string) => r !== Rol.CLIENTE),
          );

          // Actualizar último login
          await this.prisma.usuario.update({
            where: { id: usuario.id },
            data: { lastLoginAt: new Date() },
          });

          // Generar tokens sin contexto de tenant
          const tokens = await this.generateTokens(usuario, undefined, undefined, undefined, clientInfo, undefined);

          // Log de auditoría
          this.auditLogger.logUserLogin(usuario.id, email, clientInfo?.ip || 'unknown', true);

          // Si solo tiene roles CLIENTE → Marketplace directo
          if (managementCompanies.length === 0) {
            this.logger.info('User has only CLIENTE roles, logging in to Marketplace mode (Google)', {
              userId: usuario.id,
              email,
            });

            return {
              user: this.buildUserResponse(usuario, { photoUrl }),
              mode: 'marketplace',
              ...tokens,
            };
          }

          // Tiene empresas de gestión → Ofrecer opciones
          this.logger.info('User requires mode selection (Google login)', {
            userId: usuario.id,
            email,
            managementCompanies: managementCompanies.length,
          });

          return {
            requiresSelection: true,
            message: '¿Qué deseas hacer?',
            user: this.buildUserResponse(usuario, { photoUrl }),
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
                availableCompanies: managementCompanies,
              },
            ],
            ...tokens,
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
        user: this.buildUserResponse(usuario, { photoUrl }),
        mode: empresaId ? 'management' : 'marketplace',
        tenant: empresaId ? {
          id: empresaId,
          name: tenantName,
          role: tenantRole,
          availableRoles: availableRoles,
        } : undefined,
        ...tokens,
      };
    } catch (error: any) {
      this.logger.error('Google authentication failed', error?.stack);

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Error al autenticar con Google: ' + (error?.message || 'Error desconocido'));
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

  /**
   * Cambiar empresa activa (switch tenant)
   */
  async switchTenant(
    userId: string,
    empresaId: string,
    subdominioEmpresa?: string,
  ): Promise<{ success: boolean; message: string; empresaId: string; empresaNombre: string }> {
    this.logger.info('Switching tenant', { userId, empresaId });

    // Verificar que el usuario tiene acceso a la empresa
    const userRole = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: userId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        empresa: true,
      },
    });

    if (!userRole) {
      this.logger.warn('User does not have access to empresa', { userId, empresaId });
      throw new NotFoundException('No tienes acceso a esta empresa o la empresa no existe');
    }

    if (!userRole.empresa || userRole.empresa.deletedAt) {
      this.logger.warn('Empresa not found or deleted', { empresaId });
      throw new NotFoundException('Empresa no encontrada');
    }

    // Obtener todos los roles del usuario en la nueva empresa
    const rolesEnEmpresa = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        usuarioId: userId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    const tenantRoles = rolesEnEmpresa.map(r => r.rol);
    const tenantRole = userRole.rol;

    // Actualizar TODAS las sesiones activas del usuario con el nuevo contexto (en paralelo)
    try {
      const userSessions = await this.sessionService.getUserSessions(userId);

      await Promise.all(
        userSessions.map(session =>
          this.sessionService.updateSessionTenant(session.sessionId, {
            tenantId: empresaId,
            tenantRole: tenantRole,
            tenantName: userRole.empresa.nombre,
            tenantRoles: tenantRoles,
          }),
        ),
      );

      this.logger.info('Updated tenant context in sessions', {
        userId,
        sessionCount: userSessions.length,
        newTenantId: empresaId,
      });
    } catch (error: any) {
      this.logger.warn('Failed to update some sessions during tenant switch', {
        userId,
        empresaId,
        error: error?.message || String(error),
      });
      // No lanzar error - el switch es exitoso aunque falle actualizar sesiones
    }

    this.logger.success('Tenant switched successfully', {
      userId,
      empresaId,
      empresaNombre: userRole.empresa.nombre,
    });

    return {
      success: true,
      message: 'Empresa cambiada exitosamente',
      empresaId: userRole.empresa.id,
      empresaNombre: userRole.empresa.nombre,
    };
  }

  /**
   * Establecer contraseña para usuarios que se registraron con OAuth (ej. Google)
   * O para usuarios con contraseña temporal que necesitan cambiarla
   * Permite vincular método PASSWORD a una cuenta existente
   */
  async setPassword(userId: string, password: string) {
    // Buscar usuario
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
    });

    if (!usuario || !usuario.isActive) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Verificar si ya tiene método PASSWORD
    const existingPasswordProvider = await this.prisma.authProvider.findFirst({
      where: {
        userId: usuario.id,
        provider: 'PASSWORD',
      },
    });

    // CASO ESPECIAL: Permitir cambio de contraseña temporal
    if (existingPasswordProvider && usuario.requiereCambioPassword) {
      // Usuario tiene contraseña temporal y debe cambiarla
      const passwordHash = await bcrypt.hash(password, 12);

      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          passwordHash,
          requiereCambioPassword: false,
          ultimoCambioPassword: new Date(),
        },
      });

      // Revocar TODAS las sesiones (el usuario será redirigido al login)
      const revokedCount = await this.sessionService.revokeAllUserSessions(userId);
      this.logger.info('All sessions revoked after temporary password change', {
        userId,
        revokedCount,
      });

      // Log de auditoría
      this.auditLogger.logPasswordChanged(userId, usuario.email || usuario.id, userId);

      this.logger.success('Temporary password changed successfully', {
        userId,
        email: usuario.email,
      });

      return {
        success: true,
        message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión normalmente.',
      };
    }

    // Si ya tiene contraseña y NO requiere cambio, debe usar change-password
    if (existingPasswordProvider) {
      throw new ConflictException('Este usuario ya tiene configurado el login con contraseña. Usa "Cambiar contraseña" en su lugar.');
    }

    // CASO NORMAL: Usuario OAuth sin contraseña
    // Hash de la contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    // Actualizar usuario con la contraseña e incrementar authMethodsCount
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash,
        authMethodsCount: {
          increment: 1,
        },
      },
    });

    // Crear AuthProvider para método PASSWORD
    await this.prisma.authProvider.create({
      data: {
        userId: usuario.id,
        provider: 'PASSWORD',
        providerId: usuario.id,
        email: usuario.email,
        isActive: true,
      },
    });

    // Log de auditoría
    this.auditLogger.logPasswordChanged(userId, usuario.email, userId);

    this.logger.success('Password method added to user account', {
      userId,
      email: usuario.email,
    });

    return {
      success: true,
      message: 'Contraseña establecida exitosamente. Ahora puedes iniciar sesión con email y contraseña.',
    };
  }

  /**
   * Verificar métodos de autenticación disponibles para un email
   * Útil para el frontend: saber si mostrar campo de contraseña o botón de Google
   */
  async checkAuthMethods(email: string) {
    // Normalizar email para que el lookup sea consistente con login (`Mathidev@…` ≡ `mathidev@…`)
    const normalizedEmail = email.trim().toLowerCase();

    // Buscar usuario por email
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: normalizedEmail },
    });

    if (!usuario) {
      // No revelar si el email existe o no por seguridad
      return {
        email: normalizedEmail,
        exists: false,
        methods: [],
      };
    }

    // Obtener todos los AuthProviders activos para este usuario
    const authProviders = await this.prisma.authProvider.findMany({
      where: {
        userId: usuario.id,
        isActive: true,
      },
      select: {
        provider: true,
      },
    });

    const availableMethods = authProviders.map(ap => ap.provider);

    return {
      email: normalizedEmail,
      exists: true,
      methods: availableMethods, // Ej: ['PASSWORD', 'GOOGLE']
      authMethodsCount: usuario.authMethodsCount,
    };
  }

  /**
   * Obtener perfil completo del usuario desde BD
   */
  async getProfileFromDb(userId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { persona: true },
    });

    if (!usuario || !usuario.isActive) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const persona = usuario.persona;
    const perfilCompleto = !!(persona.dni && persona.telefono && persona.direccion);

    return {
      id: usuario.id,
      email: usuario.email,
      dni: persona.dni,
      nombres: persona.nombres,
      apellidos: persona.apellidos,
      telefono: persona.telefono || usuario.telefono,
      direccion: persona.direccion,
      emailVerificado: usuario.emailVerificado,
      telefonoVerificado: usuario.telefonoVerificado,
      rolGlobal: usuario.rolGlobal,
      metodoPrincipalLogin: usuario.metodoPrincipalLogin,
      lastLoginAt: usuario.lastLoginAt,
      perfilCompleto,
    };
  }

  /**
   * Actualizar perfil del usuario (DNI, teléfono, dirección)
   */
  async updateProfile(userId: string, data: UpdateProfileDto) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { persona: true },
    });

    if (!usuario || !usuario.isActive) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Validar unicidad de DNI si se proporciona
    if (data.dni && data.dni !== usuario.persona.dni) {
      const existingDni = await this.prisma.persona.findUnique({
        where: { dni: data.dni },
      });
      if (existingDni && existingDni.id !== usuario.persona.id) {
        throw new ConflictException('El DNI ya está registrado por otro usuario');
      }
    }

    // Validar unicidad de teléfono si se proporciona
    if (data.telefono && data.telefono !== usuario.telefono) {
      const existingTelefono = await this.prisma.usuario.findUnique({
        where: { telefono: data.telefono },
      });
      if (existingTelefono && existingTelefono.id !== usuario.id) {
        throw new ConflictException('El teléfono ya está registrado por otro usuario');
      }
    }

    // Actualizar Persona y Usuario en transacción
    const [personaActualizada] = await this.prisma.$transaction([
      this.prisma.persona.update({
        where: { id: usuario.persona.id },
        data: {
          ...(data.dni !== undefined && { dni: data.dni }),
          ...(data.nombres !== undefined && { nombres: data.nombres }),
          ...(data.apellidos !== undefined && { apellidos: data.apellidos }),
          ...(data.telefono !== undefined && { telefono: data.telefono }),
          ...(data.direccion !== undefined && { direccion: data.direccion }),
          ...(data.departamento !== undefined && { departamento: data.departamento }),
          ...(data.provincia !== undefined && { provincia: data.provincia }),
          ...(data.distrito !== undefined && { distrito: data.distrito }),
        },
      }),
      // Sincronizar teléfono en Usuario también
      ...(data.telefono !== undefined
        ? [
            this.prisma.usuario.update({
              where: { id: userId },
              data: { telefono: data.telefono },
            }),
          ]
        : []),
    ]);

    const perfilCompleto = !!(
      (data.dni || usuario.persona.dni) &&
      (data.telefono || usuario.persona.telefono) &&
      (data.direccion || usuario.persona.direccion)
    );

    this.logger.info('User profile updated', {
      userId,
      updatedFields: Object.keys(data).filter((k) => data[k] !== undefined),
    });

    return {
      success: true,
      message: 'Perfil actualizado exitosamente',
      user: {
        id: usuario.id,
        email: usuario.email,
        dni: data.dni || usuario.persona.dni,
        nombres: personaActualizada.nombres,
        apellidos: personaActualizada.apellidos,
        telefono: data.telefono || usuario.persona.telefono,
        direccion: data.direccion || usuario.persona.direccion,
        emailVerificado: usuario.emailVerificado,
        rolGlobal: usuario.rolGlobal,
        metodoPrincipalLogin: usuario.metodoPrincipalLogin,
        perfilCompleto,
      },
    };
  }

  /**
   * Helper para construir el objeto user en respuestas de auth
   */
  /**
   * Vincula la cuenta actual (Google) con una cuenta existente (DNI)
   * Mueve el AuthProvider de Google al usuario original y elimina el duplicado
   */
  async linkAccount(
    currentUserId: string,
    dto: { dni: string; targetPersonaId: string; targetPassword: string },
    request?: any,
  ) {
    // 1. Cargar ambas cuentas
    const currentUser = await this.prisma.usuario.findUnique({
      where: { id: currentUserId },
      include: { persona: true },
    });

    if (!currentUser) {
      throw new NotFoundException('Usuario actual no encontrado');
    }

    const targetPersona = await this.prisma.persona.findUnique({
      where: { id: dto.targetPersonaId },
      include: { usuario: true },
    });

    if (!targetPersona || !targetPersona.usuario) {
      throw new NotFoundException('Cuenta destino no encontrada');
    }

    const targetUser = targetPersona.usuario;

    // 2. Validaciones
    if (targetPersona.dni !== dto.dni) {
      throw new BadRequestException('El DNI no coincide con la cuenta destino');
    }

    if (currentUser.id === targetUser.id) {
      throw new BadRequestException('No puedes vincular tu cuenta contigo mismo');
    }

    if (!targetUser.isActive) {
      throw new BadRequestException('La cuenta destino está desactivada');
    }

    // 2.5 Probar control sobre la cuenta destino: si tiene password,
    // validar contra bcrypt. Si la cuenta destino es DNI-only sin
    // password (passwordHash=null), rechazar y pedir al dueño que
    // primero establezca una. Sin esto, cualquiera con login Google
    // que conozca el DNI ajeno podía adueñarse de esa cuenta.
    if (!targetUser.passwordHash) {
      throw new BadRequestException(
        'La cuenta destino no tiene contraseña configurada. Pídele al dueño que establezca una desde Seguridad de la cuenta antes de vincular.',
      );
    }
    const isPasswordValid = await bcrypt.compare(
      dto.targetPassword,
      targetUser.passwordHash,
    );
    if (!isPasswordValid) {
      this.logger.warn('Intento de link-account con password inválido', {
        currentUserId,
        targetUserId: targetUser.id,
        dni: dto.dni,
      });
      throw new UnauthorizedException(
        'Contraseña incorrecta para la cuenta destino',
      );
    }

    // Verificar que el usuario actual tiene Google
    const currentGoogleProvider = await this.prisma.authProvider.findFirst({
      where: { userId: currentUser.id, provider: 'GOOGLE', isActive: true },
    });

    if (!currentGoogleProvider) {
      throw new BadRequestException('Tu cuenta no tiene Google vinculado');
    }

    // Verificar que la cuenta destino NO tiene Google ya
    const targetGoogleProvider = await this.prisma.authProvider.findFirst({
      where: { userId: targetUser.id, provider: 'GOOGLE', isActive: true },
    });

    if (targetGoogleProvider) {
      throw new ConflictException('La cuenta destino ya tiene una cuenta de Google vinculada');
    }

    // 3. Ejecutar merge en transacción
    const emailToTransfer = currentUser.email;

    await this.prisma.$transaction(async (tx) => {
      // Primero: limpiar email y telefono del usuario duplicado para evitar unique constraint
      await tx.usuario.update({
        where: { id: currentUser.id },
        data: { email: null, telefono: null },
      });

      // Mover Google AuthProvider al usuario destino
      await tx.authProvider.update({
        where: { id: currentGoogleProvider.id },
        data: { userId: targetUser.id },
      });

      // Actualizar email y datos del usuario destino
      await tx.usuario.update({
        where: { id: targetUser.id },
        data: {
          email: emailToTransfer || targetUser.email,
          emailVerificado: true,
          authMethodsCount: { increment: 1 },
        },
      });

      // Actualizar email en persona destino
      if (emailToTransfer && !targetPersona.email) {
        await tx.persona.update({
          where: { id: targetPersona.id },
          data: { email: emailToTransfer },
        });
      }

      // Mover dispositivos FCM (eliminar duplicados primero)
      const targetDevices = await tx.dispositivoNotificacion.findMany({
        where: { usuarioId: targetUser.id },
        select: { fcmToken: true },
      });
      const targetTokens = new Set(targetDevices.map(d => d.fcmToken));

      // Eliminar devices del usuario actual que ya existen en destino
      if (targetTokens.size > 0) {
        await tx.dispositivoNotificacion.deleteMany({
          where: {
            usuarioId: currentUser.id,
            fcmToken: { in: Array.from(targetTokens) },
          },
        });
      }

      // Mover los restantes
      await tx.dispositivoNotificacion.updateMany({
        where: { usuarioId: currentUser.id },
        data: { usuarioId: targetUser.id },
      });

      // Mover notificaciones
      await tx.notificacion.updateMany({
        where: { usuarioId: currentUser.id },
        data: { usuarioId: targetUser.id },
      });

      // Mover preferencias (eliminar duplicados)
      const targetPrefs = await tx.preferenciaNotificacion.findMany({
        where: { usuarioId: targetUser.id },
        select: { tipo: true },
      });
      const targetTipos = new Set(targetPrefs.map(p => p.tipo));

      if (targetTipos.size > 0) {
        await tx.preferenciaNotificacion.deleteMany({
          where: {
            usuarioId: currentUser.id,
            tipo: { in: Array.from(targetTipos) },
          },
        });
      }

      await tx.preferenciaNotificacion.updateMany({
        where: { usuarioId: currentUser.id },
        data: { usuarioId: targetUser.id },
      });

      // Limpiar relaciones del usuario duplicado (EmpresaPersona, EmpresaUsuarioRol)
      await tx.empresaUsuarioRol.deleteMany({
        where: { usuarioId: currentUser.id },
      });

      await tx.empresaPersona.deleteMany({
        where: { personaId: currentUser.persona.id },
      });

      // Eliminar otros AuthProviders del duplicado
      await tx.authProvider.deleteMany({
        where: { userId: currentUser.id },
      });

      // Eliminar usuario duplicado
      await tx.usuario.delete({
        where: { id: currentUser.id },
      });

      // Eliminar persona duplicada
      await tx.persona.delete({
        where: { id: currentUser.persona.id },
      });
    });

    // 4. Revocar sesiones del usuario duplicado (fuera de transacción)
    await this.sessionService.revokeAllUserSessions(currentUser.id);

    // 5. Generar nuevos tokens para el usuario destino
    const clientInfo = request ? this.securityService.getClientInfo(request) : {
      ip: '127.0.0.1',
      userAgent: 'Unknown Device',
      device: 'Link Account',
      platform: 'Unknown',
    };

    // Recargar usuario destino con datos actualizados
    const updatedTargetUser = await this.prisma.usuario.findUnique({
      where: { id: targetUser.id },
      include: { persona: true },
    });

    const tokens = await this.generateTokens(updatedTargetUser, undefined, undefined, undefined, clientInfo, undefined);

    this.logger.success('Accounts linked successfully', {
      duplicateUserId: currentUser.id,
      targetUserId: targetUser.id,
      dni: dto.dni,
    });

    return {
      success: true,
      message: 'Cuentas vinculadas exitosamente. Ahora puedes usar Google y DNI para acceder.',
      user: this.buildUserResponse(updatedTargetUser),
      ...tokens,
    };
  }

  /**
   * Autorizar operación privilegiada (anulación, etc.)
   * Un admin/gerente valida con su DNI+contraseña para autorizar la operación
   */
  async autorizarOperacion(empresaId: string, solicitanteId: string, dto: AutorizarOperacionDto) {
    // 1. Find persona by DNI
    const persona = await this.prisma.persona.findFirst({
      where: { dni: dto.dni },
      include: { usuario: true },
    });

    if (!persona || !persona.usuario) {
      throw new UnauthorizedException('DNI no encontrado');
    }

    const usuario = persona.usuario;

    // 2. Validate password
    if (!usuario.passwordHash) {
      throw new UnauthorizedException('El usuario no tiene contraseña configurada');
    }

    const passwordValid = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    // 3. Validate user belongs to this empresa with admin role
    const empresaRol = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: usuario.id,
        empresaId,
        isActive: true,
        deletedAt: null,
        rol: { in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'] },
      },
    });

    // Also check sede roles
    let tienePermisoSede = false;
    if (!empresaRol) {
      const sedeRol = await this.prisma.usuarioSedeRol.findFirst({
        where: {
          usuarioId: usuario.id,
          sede: { empresaId },
          rol: { in: ['GERENTE_SEDE', 'ADMINISTRADOR', 'SUPERVISOR'] },
          isActive: true,
        },
      });
      tienePermisoSede = !!sedeRol;
    }

    if (!empresaRol && !tienePermisoSede) {
      throw new UnauthorizedException('El usuario no tiene permisos de administrador para autorizar esta operacion');
    }

    // 4. Log the authorization
    this.logger.log(`Operacion autorizada: ${dto.operacion} por ${persona.nombres} ${persona.apellidos} (DNI: ${dto.dni}), solicitado por userId: ${solicitanteId}`);

    return {
      authorized: true,
      autorizadoPorId: usuario.id,
      autorizadoPorNombre: `${persona.nombres} ${persona.apellidos}`.trim(),
    };
  }

  /**
   * Agregar o cambiar el email del usuario autenticado.
   *
   * Casos de uso:
   * - Cuenta DNI-only (email=null) que quiere agregar un email para luego
   *   poder vincular login Google.
   * - Usuario que cambió de proveedor de correo y necesita actualizar.
   *
   * Reglas:
   * - El nuevo email no puede estar ocupado por otro Usuario (case-insensitive).
   * - El nuevo email queda con `emailVerificado=false`.
   * - Se envía email de verificación a la nueva dirección.
   * - Persona.email se sincroniza si la persona no tiene otra cuenta colgando.
   * - Si el email es exactamente el mismo que el actual: no-op idempotente.
   */
  async updateEmail(userId: string, email: string, currentPassword?: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { persona: true },
    });

    if (!usuario || !usuario.isActive) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // No-op si ya está usando ese mismo email.
    if (usuario.email && usuario.email.toLowerCase() === normalizedEmail) {
      return {
        success: true,
        message: 'Tu cuenta ya tiene ese email asociado.',
        emailVerificado: usuario.emailVerificado,
      };
    }

    // Hardening: si la cuenta tiene contraseña configurada, exigirla
    // antes de cambiar el email. Cuentas Google-only o DNI-only sin
    // password (passwordHash == null) están exentas — su factor de
    // autenticación es OAuth o el código DNI, ya validado por el JWT.
    if (usuario.passwordHash) {
      if (!currentPassword || currentPassword.length === 0) {
        throw new BadRequestException(
          'Ingresa tu contraseña actual para confirmar el cambio de email.',
        );
      }
      const ok = await bcrypt.compare(currentPassword, usuario.passwordHash);
      if (!ok) {
        throw new UnauthorizedException('Contraseña actual incorrecta.');
      }
    }

    // El email no puede pertenecer a otro Usuario.
    const conflict = await this.prisma.usuario.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        NOT: { id: usuario.id },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('Ese email ya está registrado en otra cuenta');
    }

    const verificationToken = uuidv4();
    const verificationExpiration = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: usuario.id },
        data: {
          email: normalizedEmail,
          emailVerificado: false,
          emailVerificationToken: verificationToken,
          emailVerificationExpiracion: verificationExpiration,
        },
      });

      // Sincronizar AuthProvider.email para providers que reflejan el email del
      // Usuario (PASSWORD). Los GOOGLE.email NO se tocan: representan la cuenta
      // Gmail vinculada y son independientes del email del Usuario.
      await tx.authProvider.updateMany({
        where: {
          userId: usuario.id,
          provider: 'PASSWORD',
        },
        data: { email: normalizedEmail },
      });

      // Sincronizar Persona.email solo si la persona NO tiene otro Usuario
      // distinto colgando (caso edge: una persona con varios usuarios). En
      // duda, dejamos Persona.email tal cual y sólo actualizamos Usuario.
      if (usuario.persona) {
        const otrosUsuarios = await tx.usuario.count({
          where: {
            personaId: usuario.persona.id,
            NOT: { id: usuario.id },
          },
        });
        if (otrosUsuarios === 0) {
          await tx.persona.update({
            where: { id: usuario.persona.id },
            data: { email: normalizedEmail },
          });
        }
      }
    });

    // Enviar email de verificación a la nueva dirección.
    try {
      await this.emailService.sendVerificationEmail(
        normalizedEmail,
        verificationToken,
        usuario.persona?.nombres || 'Usuario',
      );
    } catch (error: any) {
      this.logger.error(
        'Failed to send verification email after email update',
        error?.stack,
        { userId: usuario.id, email: normalizedEmail },
      );
      // No revertimos la actualización: el usuario puede pedir reenvío.
    }

    // Notificar al email anterior (si existe) para que el dueño
    // legítimo pueda detectar un cambio no autorizado. Best-effort.
    if (usuario.email) {
      try {
        await this.emailService.sendEmailChangedNotification(
          usuario.email,
          normalizedEmail,
          usuario.persona?.nombres || 'Usuario',
        );
      } catch (error: any) {
        this.logger.warn(
          'Failed to send email-change notification to previous email',
          { userId: usuario.id, previousEmail: usuario.email, error: error?.message },
        );
      }
    }

    // Revocar TODAS las sesiones, incluida la actual. El email es parte
    // del payload visible del usuario (login, recuperación, contacto), por
    // lo que tras un cambio queremos que el usuario re-autentique para
    // que la app rehidrate su estado con el nuevo email + emailVerificado=false.
    const revokedCount = await this.sessionService.revokeAllUserSessions(usuario.id);
    this.logger.info('All sessions revoked after email update', {
      userId: usuario.id,
      revokedCount,
    });

    this.logger.info('Email updated for user', {
      userId: usuario.id,
      previousEmail: usuario.email,
      newEmail: normalizedEmail,
      changeType: 'email_update',
    });

    return {
      success: true,
      message:
        'Email actualizado. Te enviamos un correo de verificación a la nueva dirección. Vuelve a iniciar sesión.',
      emailVerificado: false,
      email: normalizedEmail,
      sessionsRevoked: true,
    };
  }

  private buildUserResponse(usuario: any, extra?: Record<string, any>) {
    const persona = usuario.persona;
    const perfilCompleto = !!(persona?.dni && (persona?.telefono || usuario.telefono) && persona?.direccion);
    return {
      id: usuario.id,
      email: usuario.email,
      dni: persona?.dni,
      nombres: persona?.nombres,
      apellidos: persona?.apellidos,
      telefono: persona?.telefono || usuario.telefono,
      direccion: persona?.direccion,
      emailVerificado: usuario.emailVerificado,
      rolGlobal: usuario.rolGlobal,
      metodoPrincipalLogin: usuario.metodoPrincipalLogin,
      perfilCompleto,
      ...extra,
    };
  }
}
