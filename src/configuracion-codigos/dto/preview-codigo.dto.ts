import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TipoCodigo {
  PRODUCTO = 'PRODUCTO',
  VARIANTE = 'VARIANTE',
  SERVICIO = 'SERVICIO',
  VENTA = 'VENTA',
}

export class PreviewCodigoDto {
  @ApiProperty({
    description: 'Tipo de código a previsualizar',
    enum: TipoCodigo,
    example: TipoCodigo.PRODUCTO,
  })
  @IsEnum(TipoCodigo)
  tipo: TipoCodigo;

  @ApiPropertyOptional({
    description: 'ID de la sede (solo si la configuración incluye sede)',
    example: 'clxxxxx',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiPropertyOptional({
    description: 'Número específico para previsualizar (por defecto usa el próximo)',
    example: 15,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  numero?: number;
}

export class PreviewCodigoResponseDto {
  @ApiProperty({
    description: 'Código generado con la configuración actual',
    example: 'PROD-000015',
  })
  codigo: string;

  @ApiProperty({
    description: 'Formato desglosado del código',
    example: {
      prefijo: 'PROD',
      separador: '-',
      numero: '000015',
      sede: null,
    },
  })
  formato: {
    prefijo: string;
    separador: string;
    numero: string;
    sede?: string | null;
  };
}
