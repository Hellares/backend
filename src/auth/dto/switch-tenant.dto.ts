import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SwitchTenantDto {
  @ApiProperty({
    description: 'ID de la empresa a la que se quiere cambiar',
    example: 'clx1234567890abcdefghij',
  })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({
    description: 'Subdominio de la empresa (opcional)',
    example: 'mi-empresa',
  })
  @IsString()
  @IsOptional()
  subdominioEmpresa?: string;
}
