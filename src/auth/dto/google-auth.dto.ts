import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({
    description: 'ID Token obtenido desde Google Sign-In en la app móvil',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjI...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiProperty({
    description: 'Subdominio de la empresa (opcional, para segundo paso del flujo)',
    example: 'empresa123',
    required: false,
  })
  @IsString()
  @IsOptional()
  subdominioEmpresa?: string;

  @ApiProperty({
    description: 'Modo de login: marketplace (sin tenant) o management (con tenant)',
    example: 'marketplace',
    required: false,
    enum: ['marketplace', 'management'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['marketplace', 'management'])
  loginMode?: 'marketplace' | 'management';
}
