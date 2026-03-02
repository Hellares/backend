import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EstadoOrdenCompra } from '@prisma/client';

export class UpdateEstadoOrdenCompraDto {
  @ApiProperty({
    description: 'Nuevo estado',
    enum: EstadoOrdenCompra,
  })
  @IsEnum(EstadoOrdenCompra)
  estado: EstadoOrdenCompra;
}
