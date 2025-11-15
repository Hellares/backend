import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserInfoDto {
  @ApiProperty({ description: 'ID del usuario' })
  id: string;

  @ApiProperty({ description: 'Email del usuario' })
  email: string;

  @ApiProperty({ description: 'Nombres del usuario' })
  nombres: string;

  @ApiProperty({ description: 'Apellidos del usuario' })
  apellidos: string;

  @ApiProperty({ description: 'Email verificado', default: false })
  emailVerificado: boolean;

  @ApiPropertyOptional({ description: 'Rol global del usuario' })
  rolGlobal?: string;
}

export class AuthTenantInfoDto {
  @ApiProperty({ description: 'ID del tenant/empresa' })
  id: string;

  @ApiProperty({ description: 'Nombre del tenant/empresa' })
  name: string;

  @ApiProperty({ description: 'Rol del usuario en el tenant' })
  role: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Información del usuario', type: AuthUserInfoDto })
  user: AuthUserInfoDto;

  @ApiPropertyOptional({ description: 'Información del tenant si aplica', type: AuthTenantInfoDto })
  tenant?: AuthTenantInfoDto;

  @ApiProperty({ description: 'Token de acceso JWT' })
  accessToken: string;

  @ApiProperty({ description: 'Token de refresh' })
  refreshToken: string;

  @ApiProperty({ description: 'Tiempo de expiración del token' })
  expiresIn: string;
}

export class RefreshTokenResponseDto {
  @ApiProperty({ description: 'Nuevo token de acceso JWT' })
  accessToken: string;

  @ApiProperty({ description: 'Nuevo token de refresh' })
  refreshToken: string;

  @ApiProperty({ description: 'Tiempo de expiración del token' })
  expiresIn: string;
}

export class UserProfileDto {
  @ApiProperty({ description: 'ID del usuario' })
  id: string;

  @ApiProperty({ description: 'Email del usuario' })
  email: string;

  @ApiProperty({ description: 'Nombres del usuario' })
  nombres: string;

  @ApiProperty({ description: 'Apellidos del usuario' })
  apellidos: string;

  @ApiPropertyOptional({ description: 'ID del tenant actual' })
  tenantId?: string;

  @ApiPropertyOptional({ description: 'Rol en el tenant actual' })
  tenantRole?: string;

  @ApiPropertyOptional({ description: 'Nombre del tenant actual' })
  tenantName?: string;

  @ApiProperty({ description: 'Método de login utilizado' })
  loginMethod: 'local' | 'oauth' | 'sso';
}

export class MessageResponseDto {
  @ApiProperty({ description: 'Mensaje de respuesta' })
  message: string;
}