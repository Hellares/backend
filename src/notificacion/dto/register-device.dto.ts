import { IsString, IsOptional, IsIn, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM token del dispositivo' })
  @IsString()
  @MinLength(100, { message: 'FCM token inválido' })
  fcmToken: string;

  @ApiProperty({ description: 'Plataforma del dispositivo', enum: ['android', 'ios', 'web'] })
  @IsString()
  @IsIn(['android', 'ios', 'web'])
  platform: string;

  @ApiPropertyOptional({ description: 'Información adicional del dispositivo' })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
