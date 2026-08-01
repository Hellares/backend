import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoServicio, PrioridadServicio } from '@prisma/client';

export class CreateOrdenServicioDto {
  @ApiProperty({ description: 'ID de la empresa' })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiPropertyOptional({ description: 'ID del cliente persona (EmpresaPersona)' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'ID del cliente empresa (ClienteEmpresa)' })
  @IsOptional()
  @IsString()
  clienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'ID del contacto de la empresa cliente' })
  @IsOptional()
  @IsString()
  contactoClienteEmpresaId?: string;

  @ApiPropertyOptional({ description: 'ID del técnico asignado' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'ID de la sede' })
  @IsOptional()
  @IsString()
  sedeId?: string;

  @ApiProperty({
    description: 'Tipo de servicio',
    enum: TipoServicio,
    example: TipoServicio.REPARACION,
  })
  @IsEnum(TipoServicio)
  tipoServicio: TipoServicio;

  @ApiPropertyOptional({
    description: 'Prioridad',
    enum: PrioridadServicio,
    default: PrioridadServicio.NORMAL,
  })
  @IsOptional()
  @IsEnum(PrioridadServicio)
  prioridad?: PrioridadServicio;

  @ApiPropertyOptional({ description: 'Descripción del problema' })
  @IsOptional()
  @IsString()
  descripcionProblema?: string;

  @ApiPropertyOptional({ description: 'Síntomas reportados (JSON)' })
  @IsOptional()
  sintomas?: any;

  @ApiPropertyOptional({ description: 'Tipo de equipo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tipoEquipo?: string;

  @ApiPropertyOptional({ description: 'Marca del equipo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  marcaEquipo?: string;

  @ApiPropertyOptional({ description: 'Número de serie del equipo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  numeroSerie?: string;

  @ApiPropertyOptional({ description: 'ID del modelo de equipo' })
  @IsOptional()
  @IsString()
  modeloEquipoId?: string;

  @ApiPropertyOptional({ description: 'Accesorios entregados (JSON)' })
  @IsOptional()
  accesorios?: any;

  @ApiPropertyOptional({ description: 'Condición del equipo al recibir' })
  @IsOptional()
  @IsString()
  condicionEquipo?: string;

  @ApiPropertyOptional({ description: 'Notas adicionales' })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({ description: 'ID del servicio del catálogo' })
  @IsOptional()
  @IsString()
  servicioId?: string;

  @ApiPropertyOptional({
    description: 'Datos personalizados de campos configurados (JSON)',
  })
  @IsOptional()
  datosPersonalizados?: any;

  @ApiPropertyOptional({ description: 'Costo total acordado del servicio' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costoTotal?: number;

  @ApiPropertyOptional({ description: 'Adelanto entregado por el cliente' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  adelanto?: number;

  @ApiPropertyOptional({ description: 'Descuento aplicado' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuento?: number;

  @ApiPropertyOptional({ description: 'Método de pago del adelanto (EFECTIVO, YAPE, PLIN, TARJETA, etc.)' })
  @IsOptional()
  @IsString()
  metodoPagoAdelanto?: string;

  @ApiPropertyOptional({
    description:
      'Fecha PACTADA de entrega con el cliente (ISO 8601). Es el compromiso, no la entrega real (fechaEntrega)',
  })
  @IsOptional()
  @IsDateString()
  fechaPrometida?: string;

  @ApiPropertyOptional({ description: 'Incluir en sistema de avisos de mantenimiento', default: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  incluirAvisoMantenimiento?: boolean;

  @ApiPropertyOptional({ description: 'Fecha personalizada para el aviso de mantenimiento (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  fechaAvisoPersonalizado?: string;
}
