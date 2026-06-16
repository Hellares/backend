import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Asigna una política de descuento (precio especial VIP) a uno o más clientes.
 * Puede mezclar clientes B2C (EmpresaPersona) y B2B (ClienteEmpresa).
 * Al menos una de las dos listas debe traer elementos (validado en el service).
 */
export class AsignarClientesDto {
  @ApiPropertyOptional({
    description: 'IDs de clientes persona (EmpresaPersona, B2C)',
    type: [String],
    example: ['cliente-123', 'cliente-456'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clienteIds?: string[];

  @ApiPropertyOptional({
    description: 'IDs de clientes empresa (ClienteEmpresa, B2B)',
    type: [String],
    example: ['ce-123'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clienteEmpresaIds?: string[];
}
