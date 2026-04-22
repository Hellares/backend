import { IsString, IsOptional, IsBoolean, IsEmail, IsEnum, IsUrl, MinLength, MaxLength, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProveedorFacturacion } from '@prisma/client';

export class ConfiguracionFacturacionDto {
  @ApiPropertyOptional({
    description: 'Proveedor activo que emitirá los nuevos comprobantes',
    enum: ProveedorFacturacion,
  })
  @IsOptional() @IsEnum(ProveedorFacturacion)
  proveedorActivo?: ProveedorFacturacion;

  @ApiPropertyOptional({ description: 'URL API base del proveedor de facturación' }) @IsOptional() @IsUrl() proveedorRuta?: string;
  @ApiPropertyOptional({ description: 'Token/credencial del proveedor' }) @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) proveedorToken?: string;
  @ApiPropertyOptional({
    description: 'Config extra específica del proveedor (ej. Syncrofact: { companyId, branchId })',
    example: { companyId: 1, branchId: 1 },
  })
  @IsOptional() @IsObject() proveedorConfig?: Record<string, any>;
  @ApiPropertyOptional({ description: 'Activar facturación electrónica' }) @IsOptional() @IsBoolean() facturacionActiva?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsEmail() emailFacturacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(['BETA', 'PRODUCCION'], { message: 'Entorno debe ser BETA o PRODUCCION' }) entorno?: string;
  @ApiPropertyOptional({ example: 'No.034-005-0005315' }) @IsOptional() @IsString() @MaxLength(100) resolucionSunat?: string;
}
