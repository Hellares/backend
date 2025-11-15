import { ApiProperty } from '@nestjs/swagger';

export class SessionInfoDto {
  @ApiProperty({ description: 'ID de la sesión' })
  sessionId: string;

  @ApiProperty({ description: 'ID del usuario' })
  userId: string;

  @ApiProperty({ description: 'Dispositivo/SO' })
  deviceInfo: string;

  @ApiProperty({ description: 'IP de origen' })
  ipAddress: string;

  @ApiProperty({ description: 'User Agent del navegador' })
  userAgent: string;

  @ApiProperty({ description: 'Fecha de creación' })
  createdAt: Date;

  @ApiProperty({ description: 'Fecha de último acceso' })
  lastAccessAt: Date;

  @ApiProperty({ description: '¿Está activa?' })
  isActive: boolean;

  @ApiProperty({ description: 'Fecha de expiración' })
  expiresAt: Date;

  @ApiProperty({ description: '¿Es la sesión actual?' })
  isCurrentSession: boolean;
}