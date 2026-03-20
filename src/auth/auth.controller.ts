import {
  Controller,
  Post,
  Put,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { JwtAuthGuard, LocalAuthGuard, RolesGuard } from './guards';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ResendVerificationEmailDto,
  SwitchTenantDto,
  UpdateProfileDto,
} from './dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { CheckAuthMethodsDto } from './dto/check-auth-methods.dto';
import { LinkAccountDto } from './dto/link-account.dto';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Registro de nuevo usuario
   */
  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard)  // Usa THROTTLE_LIMIT desde .env
  @ApiOperation({ summary: 'Registrar nuevo usuario' })
  @ApiResponse({
    status: 201,
    description: 'Usuario registrado exitosamente',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            nombres: { type: 'string' },
            apellidos: { type: 'string' },
            emailVerificado: { type: 'boolean' },
          },
        },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        expiresIn: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Email ya registrado' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * Login de usuario
   */
  @Post('login')
  @Public()
  @UseGuards(ThrottlerGuard)  // Usa THROTTLE_LIMIT desde .env
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión' })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            nombres: { type: 'string' },
            apellidos: { type: 'string' },
            emailVerificado: { type: 'boolean' },
            rolGlobal: { type: 'string' },
          },
        },
        tenant: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        expiresIn: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos. Intente más tarde' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async login(@Body() loginDto: LoginDto, @Request() req) {
    return this.authService.login(loginDto, req);
  }

  /**
   * Autenticación con Google
   */
  @Post('google')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autenticación con Google (verificación de ID Token)',
    description: 'Autentica un usuario usando el ID Token obtenido desde Google Sign-In en la app móvil',
  })
  @ApiResponse({
    status: 200,
    description: 'Autenticación exitosa con Google',
    schema: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            nombres: { type: 'string' },
            apellidos: { type: 'string' },
            emailVerificado: { type: 'boolean' },
            rolGlobal: { type: 'string', nullable: true },
            photoUrl: { type: 'string', nullable: true },
          },
        },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        expiresIn: { type: 'string' },
        sessionId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Token de Google inválido' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos. Intente más tarde' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async authenticateWithGoogle(
    @Body() googleAuthDto: GoogleAuthDto,
    @Request() req,
  ) {
    return this.authService.authenticateWithGoogle(
      googleAuthDto.idToken,
      req,
      googleAuthDto.subdominioEmpresa,
      googleAuthDto.loginMode,
    );
  }

  /**
   * Refresh token
   */
  @Post('refresh')
  @Public()
  @UseGuards(ThrottlerGuard)  // Usa THROTTLE_LIMIT desde .env
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refrescar access token' })
  @ApiResponse({
    status: 200,
    description: 'Token refrescado exitosamente',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        expiresIn: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Refresh token inválido o expirado' })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  /**
   * Validar sesión activa
   */
  @Get('validate-session')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validar si la sesión actual está activa' })
  @ApiResponse({ status: 200, description: 'Sesión válida' })
  @ApiResponse({ status: 401, description: 'Sesión inválida o expirada' })
  async validateSession(@CurrentUser() user: any) {
    if (!user.sessionId) {
      throw new UnauthorizedException('Sesión inválida');
    }
    const isValid = await this.authService.validateSession(user.sessionId);
    if (!isValid) {
      throw new UnauthorizedException('Sesión revocada o expirada');
    }
    return { valid: true };
  }

  /**
   * Logout
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar sesión' })
  @ApiResponse({ status: 200, description: 'Sesión cerrada exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async logout(@Request() req, @CurrentUser() user: any) {
    return this.authService.logout(user.sub, user.sessionId);
  }

  /**
   * Cambiar contraseña (usuario autenticado)
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 intentos por minuto
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar contraseña del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Contraseña cambiada exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 400, description: 'Contraseña actual incorrecta o datos inválidos' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.sub, changePasswordDto, user.sessionId);
  }

  /**
   * Solicitar recuperación de contraseña
   */
  @Post('forgot-password')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar recuperación de contraseña' })
  @ApiResponse({
    status: 200,
    description: 'Si el email está registrado, recibirás instrucciones para recuperar tu contraseña',
  })
  @ApiResponse({ status: 429, description: 'Demasiados intentos. Intente más tarde' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  /**
   * Resetear contraseña
   */
  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resetear contraseña con token' })
  @ApiResponse({ status: 200, description: 'Contraseña actualizada exitosamente' })
  @ApiResponse({ status: 400, description: 'Token inválido, expirado o datos inválidos' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  /**
   * Verificar email
   */
  @Get('verify-email/:token')
  @Public()
  @ApiOperation({ summary: 'Verificar email del usuario' })
  @ApiResponse({ status: 200, description: 'Email verificado exitosamente' })
  @ApiResponse({ status: 400, description: 'Token inválido o expirado' })
  async verifyEmail(@Param('token') token: string, @Res() res: Response) {
    try {
      const result = await this.authService.verifyEmail(token);

      // Redirigir al frontend con éxito
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
      return res.redirect(`${frontendUrl}/auth/email-verified?success=true`);
    } catch (error) {
      // Redirigir al frontend con error
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
      return res.redirect(`${frontendUrl}/auth/email-verified?success=false&error=${encodeURIComponent((error as any)?.message || 'Error desconocido')}`);
    }
  }

  /**
   * Reenviar email de verificación
   */
  @Post('resend-verification-email')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 intentos por minuto
  @ApiOperation({ summary: 'Reenviar email de verificación' })
  @ApiResponse({
    status: 200,
    description: 'Email de verificación reenviado exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Email de verificación enviado. Por favor, revisa tu bandeja de entrada o spam.' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Email ya verificado o reenviado recientemente' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos, intenta nuevamente más tarde' })
  async resendVerificationEmail(@Body() resendDto: ResendVerificationEmailDto) {
    return await this.authService.resendVerificationEmail(resendDto.email);
  }

  /**
   * Obtener perfil del usuario autenticado (desde BD)
   */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Perfil del usuario',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        dni: { type: 'string', nullable: true },
        nombres: { type: 'string' },
        apellidos: { type: 'string' },
        telefono: { type: 'string', nullable: true },
        direccion: { type: 'string', nullable: true },
        emailVerificado: { type: 'boolean' },
        rolGlobal: { type: 'string', nullable: true },
        metodoPrincipalLogin: { type: 'string', nullable: true },
        perfilCompleto: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfileFromDb(user.sub);
  }

  /**
   * Actualizar perfil del usuario autenticado
   */
  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar perfil del usuario autenticado',
    description: 'Permite actualizar DNI, teléfono y dirección del usuario',
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil actualizado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'DNI o teléfono ya registrado' })
  async updateProfile(
    @CurrentUser() user: any,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.sub, updateProfileDto);
  }

  /**
   * Obtener sesiones activas del usuario
   */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener sesiones activas del usuario' })
  @ApiResponse({ status: 200, description: 'Lista de sesiones activas' })
  async getSessions(@CurrentUser() user: any) {
    return this.authService.getUserSessions(user.sub);
  }

  /**
   * Revocar sesión específica
   */
  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revocar sesión específica' })
  @ApiResponse({ status: 200, description: 'Sesión revocada exitosamente' })
  async revokeSession(
    @CurrentUser() user: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.authService.revokeSession(user.sub, sessionId);
  }

  /**
   * Revocar todas las sesiones excepto la actual
   */
  @Delete('sessions/others')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revocar todas las sesiones excepto la actual' })
  @ApiResponse({ status: 200, description: 'Sesiones de otros dispositivos revocadas' })
  async revokeOtherSessions(@CurrentUser() user: any) {
    return this.authService.revokeAllOtherSessions(user.sub, user.sessionId);
  }

  /**
   * Revocar todas las sesiones del usuario
   */
  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revocar todas las sesiones del usuario' })
  @ApiResponse({ status: 200, description: 'Todas las sesiones revocadas' })
  async revokeAllSessions(@CurrentUser() user: any) {
    return this.authService.logout(user.sub);
  }

  /**
   * Cambiar empresa activa (switch tenant)
   */
  @Post('switch-tenant')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar empresa activa',
    description: 'Permite al usuario cambiar entre sus empresas disponibles',
  })
  @ApiResponse({
    status: 200,
    description: 'Empresa cambiada exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Empresa cambiada exitosamente' },
        empresaId: { type: 'string' },
        empresaNombre: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta empresa' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async switchTenant(
    @CurrentUser() user: any,
    @Body() switchTenantDto: SwitchTenantDto,
  ) {
    return this.authService.switchTenant(
      user.sub,
      switchTenantDto.empresaId,
      switchTenantDto.subdominioEmpresa,
    );
  }

  /**
   * Establecer contraseña (para usuarios OAuth que quieren agregar login con contraseña)
   */
  @Post('set-password')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 intentos por minuto
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Establecer contraseña para usuario autenticado',
    description: 'Permite a usuarios que se registraron con Google agregar login con contraseña',
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña establecida exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Contraseña establecida exitosamente. Ahora puedes iniciar sesión con email y contraseña.' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'El usuario ya tiene contraseña configurada' })
  @ApiResponse({ status: 400, description: 'Contraseña inválida (debe cumplir requisitos de seguridad)' })
  async setPassword(
    @CurrentUser() user: any,
    @Body() setPasswordDto: SetPasswordDto,
  ) {
    return this.authService.setPassword(user.sub, setPasswordDto.password);
  }

  /**
   * Vincular cuenta actual (Google) con una cuenta existente (DNI)
   */
  @Post('link-account')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Vincular cuenta de Google con cuenta existente por DNI',
    description: 'Fusiona la cuenta actual (Google) con una cuenta que ya existe en el sistema (registrada por una empresa con DNI)',
  })
  @ApiResponse({ status: 200, description: 'Cuentas vinculadas exitosamente' })
  @ApiResponse({ status: 404, description: 'Cuenta destino no encontrada' })
  @ApiResponse({ status: 409, description: 'La cuenta destino ya tiene Google vinculado' })
  async linkAccount(
    @CurrentUser() user: any,
    @Body() linkAccountDto: LinkAccountDto,
    @Request() req: any,
  ) {
    return this.authService.linkAccount(user.sub, linkAccountDto, req);
  }

  /**
   * Verificar métodos de autenticación disponibles para un email
   */
  @Post('methods')
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verificar métodos de autenticación disponibles',
    description: 'Devuelve los métodos de autenticación disponibles para un email (PASSWORD, GOOGLE, etc.)',
  })
  @ApiResponse({
    status: 200,
    description: 'Métodos de autenticación disponibles',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'usuario@ejemplo.com' },
        exists: { type: 'boolean', example: true },
        methods: {
          type: 'array',
          items: { type: 'string' },
          example: ['PASSWORD', 'GOOGLE']
        },
        authMethodsCount: { type: 'number', example: 2 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Email inválido' })
  async checkAuthMethods(@Body() checkAuthMethodsDto: CheckAuthMethodsDto) {
    return this.authService.checkAuthMethods(checkAuthMethodsDto.email);
  }
}
