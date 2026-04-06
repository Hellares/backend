import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConsultaPlacaResponseDto {
  @ApiProperty({ example: 'T7R831' })
  placa: string;

  @ApiProperty({ example: 'MERCEDES BENZ' })
  marca: string;

  @ApiProperty({ example: 'ATEGO 1628/54' })
  modelo: string;

  @ApiPropertyOptional({ example: 'WD3YLC964FL957185' })
  serie?: string;

  @ApiProperty({ example: 'BLANCO ROJO VERDE' })
  color: string;

  @ApiPropertyOptional({ example: '906916C1094734' })
  motor?: string;

  @ApiPropertyOptional({ example: 'WD3YLC964FL957185' })
  vin?: string;
}
