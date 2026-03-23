import { PartialType, OmitType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsDateString } from 'class-validator';
import { EstadoEmpleado } from '@prisma/client';
import { CreateEmpleadoDto } from './create-empleado.dto';

export class UpdateEmpleadoDto extends PartialType(
  OmitType(CreateEmpleadoDto, ['usuarioId'] as const),
) {
  @ApiPropertyOptional({
    description: 'Estado del empleado',
    enum: EstadoEmpleado,
    example: EstadoEmpleado.ACTIVO,
  })
  @IsOptional()
  @IsEnum(EstadoEmpleado, { message: 'Estado de empleado inválido' })
  estado?: EstadoEmpleado;

  @ApiPropertyOptional({
    description: 'Fecha de cese del empleado',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de cese debe ser una fecha válida (ISO 8601)' })
  fechaCese?: string;
}
