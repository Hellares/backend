import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsDateString, IsString } from 'class-validator';

export class QueryResumenFinancieroDto {
  @ApiProperty({ required: false, example: '2026-03-01' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiProperty({ required: false, example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiProperty({
    required: false,
    description:
      'Filtra el resumen a UNA sede (ventas/compras/CxC/CxP/caja/tesorería). ' +
      'Bancos, préstamos y pedidos marketplace son de empresa y quedan fuera ' +
      'de los totales cuando se filtra por sede.',
  })
  @IsOptional()
  @IsString()
  sedeId?: string;
}
