import { IsString, IsOptional, IsEnum, IsUrl, MinLength, MaxLength, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProveedorFacturacion } from '@prisma/client';

export class ProbarConexionDto {
  @ApiProperty({
    description: 'Proveedor a probar',
    enum: ProveedorFacturacion,
  })
  @IsEnum(ProveedorFacturacion)
  proveedorActivo!: ProveedorFacturacion;

  @ApiProperty({ description: 'URL API base del proveedor' })
  @IsUrl({ require_tld: false })
  proveedorRuta!: string;

  @ApiProperty({ description: 'Token/credencial del proveedor' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  proveedorToken!: string;

  @ApiPropertyOptional({
    description: 'Config extra específica del proveedor (ej. Syncrofact: { companyId, branchId })',
    example: { companyId: 1, branchId: 1 },
  })
  @IsOptional()
  @IsObject()
  proveedorConfig?: Record<string, any>;
}

export interface ProbarConexionResponse {
  ok: boolean;
  mensaje: string;
  proveedor: ProveedorFacturacion;
  /** Company del token en el proveedor (Syncrofact). */
  companyId?: number | null;
  branches?: Array<{
    branchIdProveedor: number;
    codigo: string;
    nombre: string;
    totalSeries: number;
  }>;
  error?: string;
}
