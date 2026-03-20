import { ApiProperty } from '@nestjs/swagger';

export class TipoCambioResponseDto {
  @ApiProperty({ example: '2026-03-19' })
  fecha: string;

  @ApiProperty({ example: 3.773 })
  compra: number;

  @ApiProperty({ example: 3.781 })
  venta: number;
}
