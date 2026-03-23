import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoAdelanto } from '@prisma/client';

export class QueryAdelantosDto {
  @ApiPropertyOptional({
    description: 'Filtrar por empleado',
    example: 'clxxxxxxxxxxxxxxxxx',
  })
  @IsOptional()
  @IsString()
  empleadoId?: string;

  @ApiPropertyOptional({
    description: 'Filtrar por estado del adelanto',
    enum: EstadoAdelanto,
    example: EstadoAdelanto.PENDIENTE_ADELANTO,
  })
  @IsOptional()
  @IsEnum(EstadoAdelanto, { message: 'Estado de adelanto inválido' })
  estado?: EstadoAdelanto;

  @ApiPropertyOptional({
    description: 'Página actual',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Elementos por página',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;
}
