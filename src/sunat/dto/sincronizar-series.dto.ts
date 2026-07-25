import { IsString, IsOptional, IsInt, IsEnum, ValidateNested, ArrayNotEmpty, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PreviewSincronizacionQueryDto {
  @ApiPropertyOptional({ description: 'Sede a sincronizar (series del RUC principal)' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'Emisor socio a sincronizar (multi-RUC, series propias)' })
  @IsOptional()
  @IsString()
  emisorId?: string;
}

export class SeleccionSerieDto {
  @ApiProperty({ description: 'Código SUNAT tipo documento', example: '01' })
  @IsString()
  tipoDocumento: string;

  @ApiProperty({ description: 'Serie tal como viene del proveedor', example: 'F002' })
  @IsString()
  serieProveedor: string;

  @ApiProperty({ description: 'Correlativo actual en el proveedor', example: 5 })
  @IsInt()
  correlativoProveedor: number;

  @ApiProperty({ enum: ['APLICAR', 'OMITIR'], description: 'Si se aplica el cambio' })
  @IsEnum(['APLICAR', 'OMITIR'])
  accion: 'APLICAR' | 'OMITIR';
}

export class AplicarSincronizacionDto {
  @ApiPropertyOptional({ description: 'ID de la sede (series del RUC principal)' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({ description: 'ID del emisor socio (multi-RUC)' })
  @IsOptional()
  @IsString()
  emisorId?: string;

  @ApiProperty({ type: [SeleccionSerieDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SeleccionSerieDto)
  selecciones: SeleccionSerieDto[];

  @ApiPropertyOptional({
    description: 'ID del branch en el proveedor (si se cambia el branch asociado a la sede)',
  })
  @IsOptional()
  branchIdProveedor?: string | number;
}
