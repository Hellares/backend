import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
  MaxLength,
} from 'class-validator';
import { TipoContrato, RegimenPension } from '@prisma/client';

export class CreateEmpleadoDto {
  @ApiProperty({
    description: 'ID del usuario a vincular como empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty({ message: 'El usuarioId es obligatorio' })
  usuarioId: string;

  @ApiProperty({
    description: 'ID de la sede donde trabaja el empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty({ message: 'La sedeId es obligatoria' })
  sedeId: string;

  @ApiPropertyOptional({
    description: 'Cargo del empleado',
    example: 'Analista de ventas',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargo?: string;

  @ApiPropertyOptional({
    description: 'Departamento al que pertenece',
    example: 'Ventas',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  departamento?: string;

  @ApiProperty({
    description: 'Fecha de ingreso del empleado',
    example: '2026-03-01',
  })
  @IsDateString({}, { message: 'La fecha de ingreso debe ser una fecha válida (ISO 8601)' })
  fechaIngreso: string;

  @ApiPropertyOptional({
    description: 'Tipo de contrato del empleado',
    enum: TipoContrato,
    default: TipoContrato.PLANILLA,
    example: TipoContrato.PLANILLA,
  })
  @IsOptional()
  @IsEnum(TipoContrato, { message: 'Tipo de contrato inválido' })
  tipoContrato?: TipoContrato;

  @ApiProperty({
    description: 'Salario base del empleado',
    example: 3500.0,
  })
  @IsNumber({}, { message: 'El salario base debe ser un número' })
  @Min(0, { message: 'El salario base no puede ser negativo' })
  salarioBase: number;

  @ApiPropertyOptional({
    description:
      'Régimen pensionario (define el descuento de pensión en planilla)',
    enum: RegimenPension,
    default: RegimenPension.NINGUNO,
  })
  @IsOptional()
  @IsEnum(RegimenPension, { message: 'Régimen pensionario inválido' })
  regimenPension?: RegimenPension;

  @ApiPropertyOptional({
    description: 'Si la empresa aporta EsSalud (9%) por este empleado',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  aportaEssalud?: boolean;

  @ApiPropertyOptional({
    description: 'Moneda del salario',
    example: 'PEN',
    default: 'PEN',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  moneda?: string;

  @ApiPropertyOptional({
    description: 'Banco donde se deposita el salario',
    example: 'BCP',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  banco?: string;

  @ApiPropertyOptional({
    description: 'Número de cuenta bancaria',
    example: '191-12345678-0-12',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroCuenta?: string;

  @ApiPropertyOptional({
    description: 'Código de Cuenta Interbancario (CCI)',
    example: '00219100123456781234',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cci?: string;

  @ApiPropertyOptional({
    description: 'ID de la plantilla de horario asignada',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  horarioPlantillaId?: string;
}
