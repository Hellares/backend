import {
  Controller,
  Post,
  Put,
  Patch,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  Headers,
  HttpCode,
  HttpStatus,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { JwtAuthGuard, LocalAuthGuard, RolesGuard, TenantAuthGuard } from './guards';
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
import { UpdateEmailDto } from './dto/update-email.dto';
import { AutorizarOperacionDto } from './dto/autorizar-operacion.dto';

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
   * Página HTML inline para restablecer contraseña. El link del correo
   * apunta aquí. Renderiza un mini-formulario que postea al endpoint API.
   * Mismo enfoque que verify-email: sin frontend web propio.
   */
  @Get('reset-password')
  @Public()
  @ApiOperation({ summary: 'Página HTML inline para restablecer contraseña' })
  async resetPasswordPage(@Request() req: any, @Res() res: Response) {
    const token = (req.query?.token as string) || '';
    if (!token) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .type('text/html; charset=utf-8')
        .send(this.renderResetResultPage(false, 'Falta el token en el enlace.'));
    }
    return res
      .status(HttpStatus.OK)
      .type('text/html; charset=utf-8')
      .send(this.renderResetForm(token));
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
      await this.authService.verifyEmail(token);
      return res
        .status(HttpStatus.OK)
        .type('text/html; charset=utf-8')
        .send(this.renderVerificationPage(true));
    } catch (error) {
      const message = (error as any)?.message || 'Token inválido o expirado';
      return res
        .status(HttpStatus.BAD_REQUEST)
        .type('text/html; charset=utf-8')
        .send(this.renderVerificationPage(false, message));
    }
  }

  /**
   * Página HTML inline para el flujo de verificación de email. Pensada para
   * el cliente móvil (sin frontend web): el usuario hace clic en el link
   * desde el correo y ve directamente el resultado, con instrucción para
   * volver a la app. Compacto, sin dependencias externas, mobile-first.
   */
  private renderVerificationPage(success: boolean, errorMessage?: string): string {
    const titulo = success ? '✅ Email verificado' : '⚠️ No se pudo verificar';
    const colorMain = success ? '#16a34a' : '#dc2626';
    const colorBg = success ? '#f0fdf4' : '#fef2f2';
    const mensaje = success
      ? 'Tu correo quedó verificado. Ya puedes volver a la app de Syncronize y continuar.'
      : (errorMessage || 'El enlace puede haber expirado o ya se usó.');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Syncronize · Verificación de email</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f8fafc; margin:0; padding:24px; color:#0f172a; }
  .card { max-width:420px; margin:32px auto; background:#fff; border-radius:14px; padding:28px; box-shadow:0 4px 24px rgba(0,0,0,.06); text-align:center; }
  .badge { font-size:48px; line-height:1; margin-bottom:8px; }
  h1 { font-size:18px; margin:8px 0 12px; color:${colorMain}; }
  p { font-size:13px; color:#475569; line-height:1.55; }
  .box { background:${colorBg}; border:1px solid ${colorMain}33; border-radius:10px; padding:12px; margin-top:12px; font-size:12px; color:${colorMain}; }
  .hint { font-size:11px; color:#94a3b8; margin-top:16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">${success ? '✅' : '⚠️'}</div>
    <h1>${titulo}</h1>
    <p>${mensaje}</p>
    <div class="box">
      ${success
        ? 'Cierra esta pestaña y vuelve a la app. Si ya iniciaste sesión, los cambios se aplican automáticamente.'
        : 'Si el problema persiste, vuelve a solicitar el envío del correo desde la app.'}
    </div>
    <p class="hint">Syncronize · Plataforma SaaS</p>
  </div>
</body>
</html>`;
  }

  /**
   * Página HTML inline con un formulario para restablecer contraseña.
   * El form postea a este mismo controlador (POST /auth/reset-password) vía
   * fetch JSON y muestra el resultado sin recargar.
   */
  private renderResetForm(token: string): string {
    const safeToken = token.replace(/"/g, '&quot;');
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Syncronize · Restablecer contraseña</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f8fafc; margin:0; padding:24px; color:#0f172a; }
  .card { max-width:420px; margin:32px auto; background:#fff; border-radius:14px; padding:24px; box-shadow:0 4px 24px rgba(0,0,0,.06); }
  h1 { font-size:18px; margin:0 0 4px; color:#075DB3; text-align:center; }
  .sub { font-size:12px; color:#475569; text-align:center; margin:0 0 18px; }
  label { display:block; font-size:12px; color:#334155; margin:10px 0 4px; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; font-size:14px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; }
  input:focus { outline:none; border-color:#075DB3; box-shadow:0 0 0 2px #075DB322; }
  button { width:100%; margin-top:16px; padding:11px 12px; font-size:14px; font-weight:600; color:#fff; background:#075DB3; border:0; border-radius:10px; cursor:pointer; }
  button[disabled] { opacity:.6; cursor:not-allowed; }
  .reqs { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 12px; margin-top:14px; font-size:11px; color:#1e3a8a; }
  .reqs li { margin-left:14px; }
  .alert { margin-top:14px; padding:10px 12px; border-radius:10px; font-size:12px; display:none; }
  .alert.ok { background:#f0fdf4; border:1px solid #86efac; color:#15803d; }
  .alert.err { background:#fef2f2; border:1px solid #fca5a5; color:#b91c1c; }
  .hint { text-align:center; font-size:11px; color:#94a3b8; margin-top:18px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Restablecer contraseña</h1>
    <p class="sub">Crea una nueva contraseña para tu cuenta.</p>
    <form id="f">
      <label for="p1">Nueva contraseña</label>
      <input id="p1" type="password" autocomplete="new-password" required minlength="8" />
      <label for="p2">Confirmar contraseña</label>
      <input id="p2" type="password" autocomplete="new-password" required minlength="8" />
      <div class="reqs">
        <strong>Requisitos:</strong>
        <ul>
          <li>Mínimo 8 caracteres</li>
          <li>Una mayúscula y una minúscula</li>
          <li>Un número y un carácter especial (@$!%*?&)</li>
        </ul>
      </div>
      <button id="b" type="submit">Cambiar contraseña</button>
      <div id="msg" class="alert"></div>
    </form>
    <p class="hint">Syncronize · Plataforma SaaS</p>
  </div>
<script>
  (function(){
    var TOKEN = "${safeToken}";
    var f = document.getElementById('f');
    var b = document.getElementById('b');
    var msg = document.getElementById('msg');
    function show(kind, text){
      msg.style.display='block';
      msg.className='alert '+(kind==='ok'?'ok':'err');
      msg.textContent=text;
    }
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var p1 = document.getElementById('p1').value;
      var p2 = document.getElementById('p2').value;
      if (p1 !== p2) { show('err','Las contraseñas no coinciden.'); return; }
      b.disabled = true; b.textContent = 'Enviando...';
      fetch('/auth/reset-password', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ resetToken: TOKEN, newPassword: p1, confirmPassword: p2 })
      }).then(function(r){ return r.json().then(function(d){ return { ok:r.ok, body:d }; }); })
        .then(function(res){
          if (res.ok) {
            f.style.display='none';
            show('ok','Contraseña actualizada. Ya puedes iniciar sesión en la app con la nueva contraseña.');
          } else {
            var m = (res.body && (res.body.message || res.body.error)) || 'No se pudo cambiar la contraseña.';
            if (Array.isArray(m)) m = m.join(' · ');
            show('err', m);
            b.disabled = false; b.textContent = 'Cambiar contraseña';
          }
        }).catch(function(){
          show('err','Error de red. Intenta de nuevo.');
          b.disabled = false; b.textContent = 'Cambiar contraseña';
        });
    });
  })();
</script>
</body>
</html>`;
  }

  private renderResetResultPage(success: boolean, message: string): string {
    const colorMain = success ? '#16a34a' : '#dc2626';
    const colorBg = success ? '#f0fdf4' : '#fef2f2';
    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Syncronize</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;margin:0;padding:24px}
.card{max-width:420px;margin:32px auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.06);text-align:center}
h1{font-size:18px;color:${colorMain}} .box{background:${colorBg};border:1px solid ${colorMain}33;border-radius:10px;padding:12px;font-size:12px;color:${colorMain}}</style></head>
<body><div class="card"><div style="font-size:48px">${success ? '✅' : '⚠️'}</div><h1>${success ? 'Listo' : 'Enlace inválido'}</h1>
<div class="box">${message}</div></div></body></html>`;
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
   * Agregar o cambiar el email del usuario autenticado.
   * Pensado para cuentas DNI-only que quieren agregar email para luego
   * vincular login Google. El nuevo email queda con `emailVerificado=false`
   * y se envía un correo de verificación.
   */
  @Patch('email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Agregar o cambiar el email de la cuenta',
    description:
      'Reemplaza el email del usuario autenticado por uno nuevo. El email queda no verificado hasta que el dueño confirma con el link enviado.',
  })
  @ApiResponse({ status: 200, description: 'Email actualizado, verificación enviada' })
  @ApiResponse({ status: 400, description: 'Email inválido' })
  @ApiResponse({ status: 409, description: 'Email ya registrado en otra cuenta' })
  async updateEmail(
    @CurrentUser() user: any,
    @Body() updateEmailDto: UpdateEmailDto,
  ) {
    return this.authService.updateEmail(
      user.sub,
      updateEmailDto.email,
      updateEmailDto.currentPassword,
    );
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

  /**
   * Autorizar operación privilegiada (anulación, etc.)
   */
  @Post('autorizar-operacion')
  @UseGuards(JwtAuthGuard, TenantAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Autorizar operacion privilegiada (anulacion, etc.)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async autorizarOperacion(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') solicitanteId: string,
    @Body() dto: AutorizarOperacionDto,
  ) {
    return this.authService.autorizarOperacion(empresaId, solicitanteId, dto);
  }
}
