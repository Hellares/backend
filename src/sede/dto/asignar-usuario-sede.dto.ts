import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional, IsBoolean, IsArray, IsNumber } from 'class-validator';
import { SedeRole } from '@prisma/client';
import { Type } from 'class-transformer';

export class AsignarUsuarioSedeDto {
  @ApiProperty({
    description: 'ID del usuario a asignar',
    example: 'cuid123456',
  })
  @IsString()
  usuarioId: string;

  @ApiProperty({
    description: 'Rol del usuario en la sede',
    enum: SedeRole,
    example: SedeRole.VENDEDOR,
  })
  @IsEnum(SedeRole, {
    message: 'El rol debe ser uno de los roles válidos de sede',
  })
  rol: SedeRole;

  @ApiPropertyOptional({
    description: 'Permisos adicionales específicos',
    example: ['ver_reportes', 'editar_precios'],
    default: [],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permisos?: string[];

  @ApiPropertyOptional({
    description: 'Indica si está activo',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Puede abrir caja',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  puedeAbrirCaja?: boolean;

  @ApiPropertyOptional({
    description: 'Puede cerrar caja',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  puedeCerrarCaja?: boolean;

  @ApiPropertyOptional({
    description: 'Límite de crédito que puede autorizar en ventas',
    example: 5000.00,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limiteCreditoVenta?: number;
}
