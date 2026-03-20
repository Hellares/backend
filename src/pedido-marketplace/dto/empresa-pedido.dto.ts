import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { EstadoPedidoMarketplace } from '@prisma/client';

export class ValidarPagoDto {
  @ApiProperty({ description: 'Aprobar o rechazar', enum: ['APROBADO', 'RECHAZADO'] })
  @IsEnum(['APROBADO', 'RECHAZADO'])
  accion: 'APROBADO' | 'RECHAZADO';

  @ApiProperty({ description: 'Motivo de rechazo (requerido si rechazado)', required: false })
  @IsOptional()
  @IsString()
  motivoRechazo?: string;
}

export class CambiarEstadoPedidoDto {
  @ApiProperty({
    description: 'Nuevo estado',
    enum: [
      EstadoPedidoMarketplace.EN_PREPARACION,
      EstadoPedidoMarketplace.ENVIADO,
      EstadoPedidoMarketplace.ENTREGADO,
      EstadoPedidoMarketplace.CANCELADO,
    ],
  })
  @IsEnum(EstadoPedidoMarketplace)
  estado: EstadoPedidoMarketplace;

  @ApiProperty({ description: 'Código de seguimiento (para envío)', required: false })
  @IsOptional()
  @IsString()
  codigoSeguimiento?: string;

  @ApiProperty({ description: 'Notas del vendedor', required: false })
  @IsOptional()
  @IsString()
  notasVendedor?: string;
}
